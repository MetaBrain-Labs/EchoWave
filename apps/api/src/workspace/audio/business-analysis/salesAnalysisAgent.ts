/**
 * DeepSeek 销售复盘 Agent。
 *
 * 将确认转写、可选角色/情绪、预检索上下文和受限知识搜索工具组合为结构化结果；
 * 用户配置只能影响分析侧重与表达风格，不能改变证据和权限规则。
 *
 * Responsibilities:
 * - 使用 DeepAgents 执行最多两次补充知识检索。
 * - 恢复、压缩并校验销售复盘 JSON，截断时使用非思考模型修复。
 *
 * Notes:
 * - 所有模型指令保持英文，中文仅作为业务输入或期望输出语言。
 */
import { randomUUID } from 'node:crypto';

import { AIMessage, type AIMessageChunk } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { concat } from '@langchain/core/utils/stream';
import { ChatDeepSeek } from '@langchain/deepseek';
import { createDeepAgent } from 'deepagents';
import { modelCallLimitMiddleware, toolCallLimitMiddleware } from 'langchain';
import { z } from 'zod';

import {
  beginAiModelCall,
  beginAiToolCall,
  noOpAiExecutionRecorder,
  type AiExecutionRecorder,
} from '../../../ai-observability/executionReporter.ts';
import { modelMessageForReport } from '../../../ai-observability/modelCallReporting.ts';
import { extractFinalMessageText, parseJsonObject } from '../../../ai-runtime/structuredOutput.ts';
import type { RagConfig } from '../../../config/workspace.ts';
import type { RetrievalChunk } from '../../../knowledge/retrieval/types.ts';
import type { BusinessAnalysisPublication, ClaimedBusinessAnalysisJob } from './repository.ts';
import { salesAnalysisContext, salesAnalysisInput, salesAnalysisRepairContext } from './CONTEXT.ts';

const CoreSummaryTitleSchema = z.enum(['overall', 'strengths', 'improvements', 'risks', 'actions']);
const ANALYSIS_MAX_OUTPUT_TOKENS = 8_000;
const REPAIR_MAX_OUTPUT_TOKENS = 5_000;
const MAX_ANALYSIS_TAGS = 12;
const OUTPUT_TOKEN_LIMIT_TOLERANCE = 16;
const analysisTagCategories = ['strength', 'improvement', 'risk', 'suggestion', 'custom'] as const;
type AnalysisTagCategory = (typeof analysisTagCategories)[number];
type TagLimitNormalization = {
  originalCount: number;
  keptCount: number;
  keptByCategory: Record<AnalysisTagCategory, number>;
};

const AgentTagSchema = z
  .object({
    category: z.enum(analysisTagCategories),
    customLabel: z.string().trim().min(1).max(24).nullable(),
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(800),
    details: z.array(z.string().trim().min(1).max(500)).max(3),
    confidence: z.number().int().min(0).max(100),
    evidenceSegmentIds: z.array(z.string().uuid()).min(1).max(50),
    citedChunkIds: z.array(z.string().uuid()).max(12),
  })
  .superRefine((input, context) => {
    for (const field of ['evidenceSegmentIds', 'citedChunkIds'] as const) {
      if (new Set(input[field]).size !== input[field].length) {
        context.addIssue({ code: 'custom', path: [field], message: `${field} must be unique.` });
      }
    }
    if ((input.category === 'custom') !== (input.customLabel !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['customLabel'],
        message: 'customLabel must be set only for category=custom.',
      });
    }
  });

const AgentResultSchema = z
  .object({
    limitations: z.array(z.string().trim().min(1).max(500)).max(4),
    summarySections: z
      .array(
        z.object({
          title: CoreSummaryTitleSchema,
          body: z.string().trim().min(1).max(2_000),
        }),
      )
      .length(5),
    tags: z.array(AgentTagSchema).max(MAX_ANALYSIS_TAGS),
  })
  .superRefine((input, context) => {
    const titles = input.summarySections.map((section) => section.title);
    if (new Set(titles).size !== CoreSummaryTitleSchema.options.length) {
      context.addIssue({
        code: 'custom',
        path: ['summarySections'],
        message: 'All core summary sections must appear exactly once.',
      });
    }
  });

const RetrievalPlanSchema = z.object({
  queries: z.array(z.string().trim().min(1).max(1_500)).min(1).max(3),
});

export class BusinessAnalysisProviderError extends Error {
  constructor(
    public readonly code: 'INVALID_MODEL_OUTPUT' | 'MODEL_TIMEOUT' | 'MODEL_UNAVAILABLE',
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'BusinessAnalysisProviderError';
  }
}

type SalesAnalysisAgentOptions = {
  ragConfig: Pick<RagConfig, 'deepSeekApiKey' | 'deepSeekBaseUrl' | 'deepSeekChatModel'>;
  fetchImplementation?: typeof fetch;
};

const localizedCoreSummaryCodes = {
  总体总结: 'overall',
  话术优点: 'strengths',
  待改进点: 'improvements',
  风险提示: 'risks',
  行动建议: 'actions',
} as const;

/** 将合法的超限标签按类别轮询收敛到业务上限，并保留入选标签的原始顺序。 */
function balanceTagLimit(tags: unknown[]): {
  tags: unknown[];
  normalization: TagLimitNormalization | null;
} {
  if (tags.length <= MAX_ANALYSIS_TAGS) return { tags, normalization: null };
  const indexedTags = tags.map((tag, index) => {
    if (!tag || typeof tag !== 'object' || Array.isArray(tag)) return null;
    const category = (tag as Record<string, unknown>).category;
    if (
      typeof category !== 'string' ||
      !analysisTagCategories.includes(category as AnalysisTagCategory)
    ) {
      return null;
    }
    return { category: category as AnalysisTagCategory, index, tag };
  });
  // 非法类别或非对象标签仍交给严格契约处理，避免数量兜底掩盖真正的结构错误。
  if (indexedTags.some((tag) => tag === null)) return { tags, normalization: null };

  const buckets = new Map(
    analysisTagCategories.map((category) => [
      category,
      indexedTags.filter(
        (tag): tag is NonNullable<(typeof indexedTags)[number]> => tag?.category === category,
      ),
    ]),
  );
  const selected: NonNullable<(typeof indexedTags)[number]>[] = [];
  let categoryOffset = 0;
  while (selected.length < MAX_ANALYSIS_TAGS) {
    let added = false;
    for (const category of analysisTagCategories) {
      const candidate = buckets.get(category)?.[categoryOffset];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length === MAX_ANALYSIS_TAGS) break;
    }
    if (!added) break;
    categoryOffset += 1;
  }
  selected.sort((left, right) => left.index - right.index);
  const keptByCategory = Object.fromEntries(
    analysisTagCategories.map((category) => [
      category,
      selected.filter((tag) => tag.category === category).length,
    ]),
  ) as Record<AnalysisTagCategory, number>;
  return {
    tags: selected.map((item) => item.tag),
    normalization: {
      originalCount: tags.length,
      keptCount: selected.length,
      keptByCategory,
    },
  };
}

/** 执行模型常见格式兼容，并返回是否发生标签数量归一化。 */
function normalizeAgentResult(value: unknown): {
  value: unknown;
  tagLimitNormalization: TagLimitNormalization | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { value, tagLimitNormalization: null };
  }
  const result = value as Record<string, unknown>;
  const balancedTags: {
    tags: unknown[];
    normalization: TagLimitNormalization | null;
  } = Array.isArray(result.tags) ? balanceTagLimit(result.tags) : { tags: [], normalization: null };
  return {
    value: {
      ...result,
      ...(Array.isArray(result.summarySections)
        ? {
            summarySections: result.summarySections.map((section) => {
              if (!section || typeof section !== 'object' || Array.isArray(section)) return section;
              const item = section as Record<string, unknown>;
              const localizedCode =
                typeof item.title === 'string'
                  ? localizedCoreSummaryCodes[item.title as keyof typeof localizedCoreSummaryCodes]
                  : undefined;
              return localizedCode ? { ...item, title: localizedCode } : item;
            }),
          }
        : {}),
      ...(Array.isArray(result.tags)
        ? {
            tags: balancedTags.tags.map((tag) => {
              if (!tag || typeof tag !== 'object' || Array.isArray(tag)) return tag;
              const item = tag as Record<string, unknown>;
              const confidence = item.confidence;
              // 部分模型会按 0-1 返回置信度；统一恢复为产品契约要求的百分制整数。
              return typeof confidence === 'number' && confidence > 0 && confidence <= 1
                ? { ...item, confidence: Math.round(confidence * 100) }
                : item;
            }),
          }
        : {}),
    },
    tagLimitNormalization: balancedTags.normalization,
  };
}

/** 在保留归一化诊断信息的同时执行销售分析严格契约校验。 */
function parseSalesAnalysisCandidate(value: unknown) {
  const normalized = normalizeAgentResult(value);
  return {
    result: AgentResultSchema.safeParse(normalized.value),
    tagLimitNormalization: normalized.tagLimitNormalization,
  };
}

/** 解析模型结果，并兼容模型将固定英文章节代码本地化为中文标题的情况。 */
export function parseSalesAnalysisResult(value: unknown) {
  return parseSalesAnalysisCandidate(value).result;
}

/** 从不同供应商命名风格的响应元数据中读取结束原因。 */
function finishReasonFromMetadata(metadata: Record<string, unknown> | undefined): string | null {
  const finishReason = metadata?.finish_reason ?? metadata?.finishReason;
  return typeof finishReason === 'string' && finishReason ? finishReason : null;
}

/** 根据供应商结束原因和解析失败时的近上限 Token 数判断输出是否被截断。 */
function outputWasTruncated(input: {
  finishReason: string | null;
  outputTokens: number | null;
  maxOutputTokens: number;
  invalidStructure: boolean;
}): boolean {
  if (input.finishReason === 'length' || input.finishReason === 'max_tokens') return true;
  return (
    input.invalidStructure &&
    input.outputTokens !== null &&
    input.outputTokens >= input.maxOutputTokens - OUTPUT_TOKEN_LIMIT_TOLERANCE
  );
}

function summarizeInvalidFields(error: z.ZodError): string {
  const fields = [
    ...new Set(error.issues.map((issue) => issue.path.map(String).join('.') || 'root')),
  ].slice(0, 3);
  return fields.join(', ');
}

/** 对一个确认版转写执行受限知识检索和结构化销售复盘。 */
export class SalesAnalysisAgent {
  private readonly model: ChatDeepSeek;
  private readonly repairModel: ChatDeepSeek;

  constructor(private readonly options: SalesAnalysisAgentOptions) {
    this.model = new ChatDeepSeek({
      apiKey: options.ragConfig.deepSeekApiKey,
      model: options.ragConfig.deepSeekChatModel,
      temperature: 0,
      maxTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      timeout: 45_000,
      configuration: {
        baseURL: options.ragConfig.deepSeekBaseUrl,
        ...(options.fetchImplementation ? { fetch: options.fetchImplementation } : {}),
      },
      // 销售复盘需要跨片段综合证据，始终显式开启思考模式，避免受通用问答开关影响。
      modelKwargs: { thinking: { type: 'enabled' } },
    });
    this.repairModel = new ChatDeepSeek({
      apiKey: options.ragConfig.deepSeekApiKey,
      model: options.ragConfig.deepSeekChatModel,
      temperature: 0,
      maxTokens: REPAIR_MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      timeout: 45_000,
      configuration: {
        baseURL: options.ragConfig.deepSeekBaseUrl,
        ...(options.fetchImplementation ? { fetch: options.fetchImplementation } : {}),
      },
      // 修复阶段只压缩和恢复 JSON，不重复执行长链思考。
      modelKwargs: { thinking: { type: 'disabled' } },
    });
  }

  /** 从确认转写提取产品、术语、需求、异议和销售阶段，生成有界主动检索查询。 */
  async planRetrievalQueries(
    job: ClaimedBusinessAnalysisJob,
    recorder: AiExecutionRecorder = noOpAiExecutionRecorder,
  ): Promise<string[]> {
    const transcript = job.segments.map((segment) => ({
      id: segment.id,
      speaker: segment.role?.label ?? segment.speakerLabel,
      text: segment.text,
    }));
    const messages = [
      {
        role: 'system' as const,
        content: [
          'Extract only terms explicitly present in the confirmed sales transcript.',
          'Identify product or service names, domain terminology, customer needs, objections, and the apparent sales stage.',
          'Create one to three concise retrieval queries for a linked internal knowledge base.',
          'Do not add facts or instructions from outside the transcript.',
          'Return only JSON: {"queries":["string"]}.',
        ].join('\n'),
      },
      {
        role: 'user' as const,
        content: JSON.stringify({ transcript, analysisFocus: job.settings.contentFocus }),
      },
    ];
    const startedAt = Date.now();
    const modelCall = beginAiModelCall(recorder, {
      name: 'business-analysis-retrieval-planning',
      displayName: '规划业务分析所需的知识检索问题',
      provider: 'deepseek',
      model: this.options.ragConfig.deepSeekChatModel,
      attempt: 1,
      reasoningMode: 'streaming',
    });
    try {
      let response: AIMessageChunk | undefined;
      for await (const chunk of await this.model.stream(messages, {
        signal: AbortSignal.timeout(20_000),
      })) {
        const reasoning = chunk.additional_kwargs.reasoning_content;
        if (typeof reasoning === 'string') modelCall.appendReasoning(reasoning);
        response = response ? concat(response, chunk) : chunk;
      }
      if (!response) throw new Error('empty-model-response');
      modelCall.finish({
        status: 'completed',
        durationMs: Date.now() - startedAt,
        inputTokens: response.usage_metadata?.input_tokens ?? null,
        outputTokens: response.usage_metadata?.output_tokens ?? null,
        input: { kind: 'chat', messages },
        output: modelMessageForReport(response),
      });
      const parsed = parseJsonObject(extractFinalMessageText([response]).text);
      const plan = RetrievalPlanSchema.safeParse(parsed);
      return plan.success ? plan.data.queries : [];
    } catch (error) {
      modelCall.finish({
        status: 'failed',
        durationMs: Date.now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        input: { kind: 'chat', messages },
        output: { error },
      });
      return [];
    }
  }

  async analyze(input: {
    job: ClaimedBusinessAnalysisJob;
    preRetrieved: RetrievalChunk[];
    searchKnowledge: (query: string) => Promise<RetrievalChunk[]>;
    recorder?: AiExecutionRecorder;
  }): Promise<BusinessAnalysisPublication> {
    const recorder = input.recorder ?? noOpAiExecutionRecorder;
    const retrievedForRepair = new Map(
      input.preRetrieved.map((chunk) => [chunk.id, chunk] as const),
    );
    const searchKnowledge = tool(
      async ({ query }) => {
        const startedAt = Date.now();
        const toolCall = beginAiToolCall(recorder, {
          name: 'search_knowledge',
          displayName: '检索分组关联知识库',
          summary: {
            audit: {
              query,
              knowledgeBases: input.job.knowledgeBases,
              hitCount: 0,
              hits: [],
            },
          },
        });
        try {
          const chunks = await input.searchKnowledge(query);
          for (const chunk of chunks) retrievedForRepair.set(chunk.id, chunk);
          toolCall.finish({
            status: 'completed',
            durationMs: Date.now() - startedAt,
            summary: {
              audit: {
                query,
                knowledgeBases: input.job.knowledgeBases,
                hitCount: chunks.length,
                hits: chunks.map((chunk) => ({
                  chunkId: chunk.id,
                  knowledgeBaseId: chunk.knowledgeBaseId,
                  documentId: chunk.documentId,
                  documentTitle: chunk.documentTitle,
                  locator: chunk.locator,
                })),
              },
            },
          });
          return JSON.stringify(
            chunks.map((chunk) => ({
              chunkId: chunk.id,
              knowledgeBaseId: chunk.knowledgeBaseId,
              documentTitle: chunk.documentTitle,
              locator: chunk.locator,
              content: chunk.content,
            })),
          );
        } catch (error) {
          toolCall.finish({
            status: 'failed',
            durationMs: Date.now() - startedAt,
            summary: {
              audit: {
                query,
                knowledgeBases: input.job.knowledgeBases,
                hitCount: 0,
                hits: [],
              },
            },
          });
          throw error;
        }
      },
      {
        name: 'search_knowledge',
        description:
          'Search only the knowledge bases linked to the current group for passages relevant to this sales review.',
        schema: z.object({ query: z.string().trim().min(1).max(1_500) }),
      },
    );
    const agent = createDeepAgent({
      name: 'echowave-sales-review-agent',
      model: this.model,
      tools: [searchKnowledge],
      subagents: [],
      skills: [],
      memory: [],
      middleware: [
        modelCallLimitMiddleware({ runLimit: 4, exitBehavior: 'error' }),
        toolCallLimitMiddleware({
          toolName: 'search_knowledge',
          runLimit: 2,
          exitBehavior: 'continue',
        }),
      ],
      permissions: [{ operations: ['read', 'write'], paths: ['/**'], mode: 'deny' }],
      systemPrompt: salesAnalysisContext(MAX_ANALYSIS_TAGS),
    });
    let result: { messages?: unknown[] } = {};
    let modelAttempt = 0;
    const latestModelCompletion: {
      value: { finishReason: string | null; outputTokens: number | null } | null;
    } = { value: null };
    let activeModelCall:
      | {
          id: string;
          startedAt: number;
          span: ReturnType<AiExecutionRecorder['beginModelCall']>;
          message?: AIMessageChunk;
          finishReason: string | null;
        }
      | undefined;
    const finishActiveModelCall = (status: 'completed' | 'failed', error?: unknown) => {
      if (!activeModelCall) return;
      const message = activeModelCall.message;
      const outputTokens = message?.usage_metadata?.output_tokens ?? null;
      const finishReason =
        activeModelCall.finishReason ??
        finishReasonFromMetadata(message?.response_metadata as Record<string, unknown> | undefined);
      if (status === 'completed') latestModelCompletion.value = { finishReason, outputTokens };
      activeModelCall.span.finish({
        status,
        durationMs: Date.now() - activeModelCall.startedAt,
        inputTokens: message?.usage_metadata?.input_tokens ?? null,
        outputTokens,
        input: { kind: 'agent-chat' },
        output: error ? { error } : message ? modelMessageForReport(message) : {},
        metadata: { finishReason },
      });
      activeModelCall = undefined;
    };
    try {
      const executionStream = await agent.stream(
        {
          messages: [{ role: 'user', content: salesAnalysisInput(input.job, input.preRetrieved) }],
        },
        {
          recursionLimit: 24,
          signal: AbortSignal.timeout(100_000),
          streamMode: ['messages', 'values'],
        },
      );
      for await (const streamed of executionStream) {
        if (!Array.isArray(streamed) || streamed.length < 2) continue;
        const [mode, payload] = streamed as [string, unknown];
        if (mode === 'values') {
          if (payload && typeof payload === 'object') result = payload as { messages?: unknown[] };
          continue;
        }
        if (mode !== 'messages' || !Array.isArray(payload)) continue;
        const message = payload[0];
        if (!(message instanceof AIMessage)) continue;
        const messageId = message.id ?? activeModelCall?.id ?? randomUUID();
        if (!activeModelCall || activeModelCall.id !== messageId) {
          finishActiveModelCall('completed');
          modelAttempt += 1;
          activeModelCall = {
            id: messageId,
            startedAt: Date.now(),
            finishReason: null,
            span: beginAiModelCall(recorder, {
              name: 'business-analysis-generation',
              displayName: '结合转写与知识证据生成业务分析',
              provider: 'deepseek',
              model: this.options.ragConfig.deepSeekChatModel,
              attempt: modelAttempt,
              reasoningMode: 'streaming',
            }),
          };
        }
        const chunk = message as AIMessageChunk;
        const reasoning = chunk.additional_kwargs.reasoning_content;
        if (typeof reasoning === 'string') activeModelCall.span.appendReasoning(reasoning);
        activeModelCall.message = activeModelCall.message
          ? concat(activeModelCall.message, chunk)
          : chunk;
        const metadata = chunk.response_metadata as Record<string, unknown>;
        const finishReason = finishReasonFromMetadata(metadata);
        if (finishReason) {
          activeModelCall.finishReason = finishReason;
          finishActiveModelCall('completed');
        }
      }
      finishActiveModelCall('completed');
    } catch (error) {
      finishActiveModelCall('failed', error);
      if (error instanceof Error && /abort|timeout/i.test(error.message)) {
        throw new BusinessAnalysisProviderError('MODEL_TIMEOUT', '销售复盘模型响应超时。', true);
      }
      throw new BusinessAnalysisProviderError(
        'MODEL_UNAVAILABLE',
        '销售复盘模型暂时不可用。',
        true,
      );
    }
    const messages = Array.isArray(result.messages) ? result.messages : [];
    const hasAiResponse = messages.some((message) => message instanceof AIMessage);
    const { text, reasoning } = extractFinalMessageText(messages);
    const parsed = parseJsonObject(text) ?? parseJsonObject(reasoning);
    const candidate = parseSalesAnalysisCandidate(parsed);
    if (candidate.result.success) {
      if (candidate.tagLimitNormalization) {
        recorder.recordStep({
          name: 'business-analysis-structure-validation',
          status: 'completed',
          metadata: { tagLimitNormalization: candidate.tagLimitNormalization },
        });
      }
      return candidate.result.data;
    }

    const invalidFields = summarizeInvalidFields(candidate.result.error);
    const finalMessage = [...messages].reverse().find((message) => message instanceof AIMessage);
    const finalMessageFinishReason =
      finalMessage instanceof AIMessage
        ? finishReasonFromMetadata(finalMessage.response_metadata as Record<string, unknown>)
        : null;
    const finishReason = latestModelCompletion.value?.finishReason ?? finalMessageFinishReason;
    const outputTokens =
      latestModelCompletion.value?.outputTokens ??
      (finalMessage instanceof AIMessage
        ? (finalMessage.usage_metadata?.output_tokens ?? null)
        : null);
    const initialTruncated = outputWasTruncated({
      finishReason,
      outputTokens,
      maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
      invalidStructure: true,
    });
    recorder.recordStep({
      name: 'business-analysis-structure-validation',
      status: 'failed',
      metadata: {
        invalidFields,
        outputTruncated: initialTruncated,
        finishReason,
        outputTokens,
        maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
        ...(candidate.tagLimitNormalization
          ? { tagLimitNormalization: candidate.tagLimitNormalization }
          : {}),
      },
    });

    const repaired = await this.repairStructure({
      job: input.job,
      retrieved: [...retrievedForRepair.values()],
      previousOutput: text,
      recorder,
    });
    if (repaired.result.success) {
      recorder.recordStep({
        name: 'business-analysis-structure-repair',
        status: 'completed',
        metadata: {
          outputTruncated: repaired.outputTruncated,
          finishReason: repaired.finishReason,
          outputTokens: repaired.outputTokens,
          maxOutputTokens: REPAIR_MAX_OUTPUT_TOKENS,
          ...(repaired.tagLimitNormalization
            ? { tagLimitNormalization: repaired.tagLimitNormalization }
            : {}),
        },
      });
      return repaired.result.data;
    }
    const repairedFields = summarizeInvalidFields(repaired.result.error);
    recorder.recordStep({
      name: 'business-analysis-structure-repair',
      status: 'failed',
      metadata: {
        invalidFields: repairedFields,
        outputTruncated: repaired.outputTruncated,
        finishReason: repaired.finishReason,
        outputTokens: repaired.outputTokens,
        maxOutputTokens: REPAIR_MAX_OUTPUT_TOKENS,
        ...(repaired.tagLimitNormalization
          ? { tagLimitNormalization: repaired.tagLimitNormalization }
          : {}),
      },
    });
    throw new BusinessAnalysisProviderError(
      'INVALID_MODEL_OUTPUT',
      hasAiResponse
        ? repaired.outputTruncated
          ? '销售复盘修复结果达到输出长度上限，请重试。'
          : `销售复盘模型返回了无效结构（字段：${repairedFields}）。`
        : '销售复盘模型没有返回结果。',
      true,
    );
  }

  /** 使用非思考模型将不完整或不合规的分析压缩为最终业务契约。 */
  private async repairStructure(input: {
    job: ClaimedBusinessAnalysisJob;
    retrieved: RetrievalChunk[];
    previousOutput: string;
    recorder: AiExecutionRecorder;
  }) {
    const messages = [
      {
        role: 'system' as const,
        content: salesAnalysisRepairContext(MAX_ANALYSIS_TAGS),
      },
      {
        role: 'user' as const,
        content: JSON.stringify({
          authoritativeInput: salesAnalysisInput(input.job, input.retrieved),
          previousOutput: input.previousOutput,
        }),
      },
    ];
    const startedAt = Date.now();
    const modelCall = beginAiModelCall(input.recorder, {
      name: 'business-analysis-structure-repair',
      displayName: '修复业务分析的结构与引用',
      provider: 'deepseek',
      model: this.options.ragConfig.deepSeekChatModel,
      attempt: 1,
      reasoningMode: 'disabled',
    });
    try {
      const response = await this.repairModel.invoke(messages, {
        signal: AbortSignal.timeout(50_000),
      });
      const { text, reasoning } = extractFinalMessageText([response]);
      const candidate = parseSalesAnalysisCandidate(
        parseJsonObject(text) ?? parseJsonObject(reasoning),
      );
      const finishReason = finishReasonFromMetadata(
        response.response_metadata as Record<string, unknown>,
      );
      const outputTokens = response.usage_metadata?.output_tokens ?? null;
      const outputTruncated = outputWasTruncated({
        finishReason,
        outputTokens,
        maxOutputTokens: REPAIR_MAX_OUTPUT_TOKENS,
        invalidStructure: !candidate.result.success,
      });
      modelCall.finish({
        status: 'completed',
        durationMs: Date.now() - startedAt,
        inputTokens: response.usage_metadata?.input_tokens ?? null,
        outputTokens,
        input: { kind: 'chat', messages },
        output: modelMessageForReport(response),
        metadata: { parsed: candidate.result.success, outputTruncated, finishReason },
      });
      return {
        result: candidate.result,
        outputTruncated,
        finishReason,
        outputTokens,
        tagLimitNormalization: candidate.tagLimitNormalization,
      };
    } catch (error) {
      modelCall.finish({
        status: 'failed',
        durationMs: Date.now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        input: { kind: 'chat', messages },
        output: { error },
      });
      if (error instanceof Error && /abort|timeout/i.test(error.message)) {
        throw new BusinessAnalysisProviderError('MODEL_TIMEOUT', '销售复盘修复超时。', true);
      }
      throw new BusinessAnalysisProviderError(
        'MODEL_UNAVAILABLE',
        '销售复盘结构修复服务暂时不可用。',
        true,
      );
    }
  }
}
