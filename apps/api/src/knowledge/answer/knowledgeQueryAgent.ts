/**
 * 知识问答适配器。
 *
 * 负责把可信回答模块提供的检索函数接入 DeepAgent，并隔离绑定供应商的 thinking 参数、
 * 结构化输出恢复和引用编号纠正等提供商细节；会话审计与引用白名单由上层模块负责。
 *
 * Responsibilities:
 * - 执行带受限检索工具的 DeepAgent。
 * - 将模型输出恢复为稳定的候选回答。
 * - 通过 JSON mode 纠正不合法的引用编号。
 *
 * Notes:
 * - 所有面向模型的说明必须保持英文。
 * - 本文件不负责数据库审计或最终网络响应组装。
 */
import {
  AIMessage,
  HumanMessage,
  RemoveMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { createDeepAgent } from 'deepagents';
import { createMiddleware, modelCallLimitMiddleware, toolCallLimitMiddleware } from 'langchain';
import { z } from 'zod';

import type { SourceLocator, KnowledgeCategory } from '@echowave/contracts';
import type { CategorySearchChoice } from '../retrieval/categoryPolicy.ts';

import {
  noOpAiExecutionRecorder,
  type AiExecutionRecorder,
} from '../../ai-observability/executionReporter.ts';
import {
  createModelCallReportingMiddleware,
  modelMessageForReport,
} from '../../ai-observability/modelCallReporting.ts';
import { createChatStyleModel, type ChatStyleModel } from '../../ai-runtime/chatModel.ts';
import { extractFinalMessageText, parseJsonObject } from '../../ai-runtime/structuredOutput.ts';
import type { RagConfig } from '../../config/workspace.ts';
import {
  citationCorrectionContext,
  citationCorrectionInput,
  groundedRescueContext,
  groundedRescueInput,
  knowledgeAgentContext,
  knowledgeFinalizationContext,
  knowledgeCategoryRoutingContext,
} from './CONTEXT.ts';

const AgentResponseSchema = z.object({
  answer: z.string(),
  grounded: z.boolean(),
  citedChunkIds: z.array(z.string().uuid()),
});

function boundedAgentResponseSchema(maxCitations: number) {
  return AgentResponseSchema.extend({
    citedChunkIds: z.array(z.string().uuid()).max(maxCitations),
  });
}

function summarizeValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.map(String),
    message: issue.message,
  }));
}

/**
 * 优先执行带引用上限的严格校验，但保留通过基础结构和 UUID 校验的超限候选。
 * 引用数量是可纠正的质量约束，不能把已有可靠证据误判为“无依据”。
 */
function recoverAgentCandidate(value: unknown, maxCitations: number) {
  const base = AgentResponseSchema.safeParse(value);
  if (!base.success) {
    return {
      candidate: null,
      citationLimitExceeded: false,
      validationIssues: summarizeValidationIssues(base.error),
    };
  }

  const bounded = boundedAgentResponseSchema(maxCitations).safeParse(base.data);
  return {
    candidate: base.data,
    citationLimitExceeded: base.data.citedChunkIds.length > maxCitations,
    validationIssues: bounded.success ? [] : summarizeValidationIssues(bounded.error),
  };
}

/** 模型生成但尚未经过本次检索白名单确认的候选回答。 */
export type AgentAnswerCandidate = z.infer<typeof AgentResponseSchema>;

/** 提供给模型工具的、已去除内部字段的检索结果。 */
export type AgentSearchResult = {
  chunks: {
    chunkId: string;
    documentTitle: string;
    locator: SourceLocator;
    content: string;
  }[];
  error?: string;
};

/** 主回答或纠正调用产生的 token 用量。 */
export type AgentTokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

/** 文本模型适配器返回给可信回答模块的候选结果。 */
export type AgentExecutionResult = {
  candidate: AgentAnswerCandidate;
  usage: AgentTokenUsage;
};

/** 主回答生成额外返回本轮被工具中间件阻止的检索统计。 */
export type AgentGenerationResult = AgentExecutionResult & {
  retrievalLimited: boolean;
  blockedRetrievalCalls: number;
};

type QueryAgentOptions = {
  ragConfig: Pick<
    RagConfig,
    'chatApiKey' | 'chatBaseUrl' | 'chatModel' | 'chatProvider' | 'enableThinking'
  >;
  checkpointer: BaseCheckpointSaver;
  /** 测试接缝：使用脚本化 HTTP 响应替代真实供应商请求。 */
  fetchImplementation?: typeof fetch;
};

/**
 * 只保留最近六轮问答，并清掉历史轮次的检索过程。
 *
 * 历史轮次的 search_knowledge 结果里含有当时检索到的段落与 chunk ID：如果继续留在上下文，
 * 模型会把它们当成本次可用证据（跨库问答尤其明显：只勾术语纠错却复述上一个库的内容），
 * 而这些 chunk 并不在本次引用的白名单里，最终会被引用校验否决。
 * 因此每个历史轮次只保留“用户问题 + 最终回答”，历史回答里的标记也不代表本轮来源。
 */
const shortConversationMiddleware = createMiddleware({
  name: 'KeepSixConversationTurns',
  beforeAgent: (state) => {
    const messages = state.messages;
    const humanIndexes = messages
      .map((message, index) => (message instanceof HumanMessage ? index : -1))
      .filter((index) => index >= 0);
    const keepFrom = humanIndexes.at(-6) ?? 0;
    const removals = messages
      .slice(0, keepFrom)
      .flatMap((message) => (message.id ? [new RemoveMessage({ id: message.id })] : []));
    const historyStart = keepFrom;
    const currentRunStart = humanIndexes.at(-1) ?? keepFrom;
    for (const [index, message] of messages.entries()) {
      // 只清理历史轮次；当前轮次的检索过程必须保留，否则模型看不到本轮证据。
      if (index < historyStart || index >= currentRunStart || !message.id) continue;
      const isToolTranscript =
        message instanceof ToolMessage ||
        (message instanceof AIMessage && (message.tool_calls?.length ?? 0) > 0);
      if (isToolTranscript) removals.push(new RemoveMessage({ id: message.id }));
    }
    return removals.length ? { messages: removals } : undefined;
  },
});

function usageFromMessages(messages: unknown[]): AgentTokenUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const message of messages) {
    if (!(message instanceof AIMessage)) continue;
    const usage = message.usage_metadata;
    inputTokens += usage?.input_tokens ?? 0;
    outputTokens += usage?.output_tokens ?? 0;
  }
  return { inputTokens, outputTokens };
}

function countBlockedRetrievalCalls(messages: unknown[]): number {
  const lastHumanIndex = findCurrentRunStart(messages);
  return messages
    .slice(lastHumanIndex)
    .filter(
      (message) =>
        message instanceof ToolMessage &&
        message.name === 'search_knowledge' &&
        message.status === 'error' &&
        typeof message.content === 'string' &&
        message.content.startsWith('Tool call limit exceeded.'),
    ).length;
}

function findCurrentRunStart(messages: unknown[]): number {
  let lastHumanIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index] instanceof HumanMessage) {
      lastHumanIndex = index;
      break;
    }
  }
  return Math.max(0, lastHumanIndex);
}

/**
 * 把绑定供应商的 DeepAgent 调用约束隐藏在稳定的生成与纠正接口之后。
 */
export class KnowledgeQueryAgent {
  private readonly model: ChatStyleModel;

  constructor(private readonly options: QueryAgentOptions) {
    // 部分文本模型默认开启 thinking；显式配置可避免 sampling 与 tool_choice 语义漂移。
    this.model = createChatStyleModel({
      providerType: options.ragConfig.chatProvider,
      apiKey: options.ragConfig.chatApiKey,
      baseUrl: options.ragConfig.chatBaseUrl,
      model: options.ragConfig.chatModel,
      temperature: 0,
      maxTokens: 1_200,
      maxRetries: 1,
      timeout: 18_000,
      thinking: options.ragConfig.enableThinking ? 'enabled' : 'disabled',
      ...(options.fetchImplementation ? { fetchImplementation: options.fetchImplementation } : {}),
    });
  }

  /**
   * 执行一次带检索工具的回答生成，只返回尚未通过引用白名单确认的候选结果。
   */
  async generate(input: {
    question: string;
    threadId: string;
    searchKnowledge: (query: string, choice?: CategorySearchChoice) => Promise<AgentSearchResult>;
    categories?: KnowledgeCategory[];
    explicitCategoryIds?: string[];
    maxSearchCalls: number;
    maxCitations: number;
    signal?: AbortSignal;
    diagnostics?: AiExecutionRecorder;
  }): Promise<AgentGenerationResult> {
    const searchKnowledge = tool(
      async ({ query, categoryIds, broaden }) =>
        JSON.stringify(await input.searchKnowledge(query, { categoryIds, broaden })),
      {
        name: 'search_knowledge',
        description:
          'Search the current Chinese knowledge base for source passages that can support the answer.',
        schema: z.object({
          query: z.string().min(1).max(2_000),
          categoryIds: z.array(z.string().uuid()).min(1).max(3).optional(),
          broaden: z.boolean().optional(),
        }),
      },
    );

    const responseSchema = boundedAgentResponseSchema(input.maxCitations);
    const systemPrompt = [
      knowledgeAgentContext(input.maxSearchCalls, input.maxCitations),
      knowledgeCategoryRoutingContext(),
      `CATEGORY_CATALOGUE: ${JSON.stringify(input.categories ?? [])}`,
      `EXPLICIT_CATEGORY_FILTER: ${JSON.stringify(input.explicitCategoryIds ?? null)}`,
    ].join('\n');
    const agent = createDeepAgent({
      name: 'echowave-knowledge-agent',
      model: this.model,
      tools: [searchKnowledge],
      subagents: [],
      skills: [],
      memory: [],
      checkpointer: this.options.checkpointer,
      middleware: [
        shortConversationMiddleware,
        createModelCallReportingMiddleware({
          recorder: input.diagnostics ?? noOpAiExecutionRecorder,
          name: 'knowledge-answer-generation',
          provider: this.options.ragConfig.chatProvider,
          model: this.options.ragConfig.chatModel,
        }),
        modelCallLimitMiddleware({ runLimit: input.maxSearchCalls + 2, exitBehavior: 'error' }),
        toolCallLimitMiddleware({
          toolName: 'search_knowledge',
          runLimit: input.maxSearchCalls,
          exitBehavior: 'continue',
        }),
      ],
      permissions: [{ operations: ['read', 'write'], paths: ['/**'], mode: 'deny' }],
      systemPrompt,
    });

    input.diagnostics?.recordContext({
      systemPrompt,
      question: input.question,
    });
    const result = await agent.invoke(
      { messages: [{ role: 'user', content: input.question }] },
      {
        configurable: { thread_id: input.threadId },
        // 中间件钩子会占用多个 graph superstep；真实工作仍由模型与工具调用上限约束。
        recursionLimit: 32,
        signal: input.signal ?? AbortSignal.timeout(20_000),
      },
    );

    const resultMessages = result.messages as BaseMessage[];
    const { text, reasoning } = extractFinalMessageText(resultMessages);
    const parsed = parseJsonObject(text) ?? parseJsonObject(reasoning);
    const initialRecovery = recoverAgentCandidate(parsed, input.maxCitations);
    let recovered = initialRecovery;
    let usage = usageFromMessages(resultMessages);
    const blockedRetrievalCalls = countBlockedRetrievalCalls(resultMessages);
    if (blockedRetrievalCalls > 0) {
      input.diagnostics?.recordToolCall({
        name: 'search_knowledge',
        status: 'failed',
        summary: {
          reason: 'run-limit',
          limit: input.maxSearchCalls,
          blockedCalls: blockedRetrievalCalls,
        },
      });
    }
    input.diagnostics?.recordReasoning(reasoning);
    input.diagnostics?.recordOutput({ rawText: text });

    if (recovered.candidate === null) {
      const currentRunMessages = resultMessages.slice(findCurrentRunStart(resultMessages));
      const currentModelCalls = currentRunMessages.filter(
        (message) => message instanceof AIMessage,
      ).length;
      if (currentModelCalls >= input.maxSearchCalls + 2) {
        throw new Error('Knowledge answer model call limit reached before finalization.');
      }

      const recoveryReason =
        blockedRetrievalCalls > 0 ? 'retrieval-limit' : 'invalid-structured-output';
      const recoveryName =
        blockedRetrievalCalls > 0 ? 'retrieval-limit-finalization' : 'structured-output-recovery';
      const finalizationPrompt = knowledgeFinalizationContext(
        blockedRetrievalCalls > 0,
        input.maxCitations,
      );
      input.diagnostics?.recordContext({
        systemPrompt: finalizationPrompt,
        reason: recoveryReason,
      });
      const finalizationStartedAt = Date.now();
      const finalizationInput = {
        kind: 'chat',
        messages: [
          { role: 'system', content: finalizationPrompt },
          ...currentRunMessages.map(modelMessageForReport),
        ],
      };
      const finalization = await (async () => {
        try {
          return await this.model
            .withStructuredOutput(responseSchema, {
              method: 'jsonMode',
              includeRaw: true,
            })
            .invoke([new SystemMessage(finalizationPrompt), ...currentRunMessages], {
              signal: input.signal ?? AbortSignal.timeout(18_000),
            });
        } catch (error) {
          input.diagnostics?.recordModelCall({
            name: recoveryName,
            provider: this.options.ragConfig.chatProvider,
            model: this.options.ragConfig.chatModel,
            status: 'failed',
            attempt: 1,
            durationMs: Date.now() - finalizationStartedAt,
            inputTokens: null,
            outputTokens: null,
            input: finalizationInput,
            output: { error },
          });
          throw error;
        }
      })();
      const finalizationUsage = usageFromMessages([finalization.raw]);
      usage = {
        inputTokens: usage.inputTokens + finalizationUsage.inputTokens,
        outputTokens: usage.outputTokens + finalizationUsage.outputTokens,
      };
      const finalizationRaw = extractFinalMessageText([finalization.raw]);
      const finalizationValue =
        finalization.parsed ??
        parseJsonObject(finalizationRaw.text) ??
        parseJsonObject(finalizationRaw.reasoning);
      recovered = recoverAgentCandidate(finalizationValue, input.maxCitations);
      input.diagnostics?.recordModelCall({
        name: recoveryName,
        provider: this.options.ragConfig.chatProvider,
        model: this.options.ragConfig.chatModel,
        status: 'completed',
        attempt: 1,
        durationMs: Date.now() - finalizationStartedAt,
        inputTokens: finalizationUsage.inputTokens,
        outputTokens: finalizationUsage.outputTokens,
        input: finalizationInput,
        output: modelMessageForReport(finalization.raw),
        metadata: {
          recoveryReason,
          initialCitationLimitExceeded: initialRecovery.citationLimitExceeded,
          initialValidationIssues: initialRecovery.validationIssues,
          parsed: recovered.candidate !== null,
          citationLimitExceeded: recovered.citationLimitExceeded,
          validationIssues: recovered.validationIssues,
        },
      });
      input.diagnostics?.recordReasoning(finalizationRaw.reasoning);
      input.diagnostics?.recordOutput({ rawText: finalizationRaw.text });
    }

    return {
      candidate: recovered.candidate
        ? recovered.candidate
        : { answer: '知识库中没有足够依据回答这个问题。', grounded: false, citedChunkIds: [] },
      usage,
      retrievalLimited: blockedRetrievalCalls > 0,
      blockedRetrievalCalls,
    };
  }

  /**
   * 仅替换越权引用 ID，不允许引入新事实或缩短答案；调用方仍需再次执行白名单校验。
   */
  async correctCitations(
    candidate: AgentAnswerCandidate,
    allowedIds: string[],
    maxCitations: number,
    signal?: AbortSignal,
    diagnostics?: AiExecutionRecorder,
  ): Promise<AgentExecutionResult> {
    const systemPrompt = citationCorrectionContext(maxCitations);
    diagnostics?.recordContext({ systemPrompt, candidate, allowedIds });
    const modelStartedAt = Date.now();
    const correctionUserPrompt = citationCorrectionInput(candidate, allowedIds);
    const correctionInput = {
      kind: 'chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: correctionUserPrompt },
      ],
    };
    const correction = await (async () => {
      try {
        return await this.model
          .withStructuredOutput(boundedAgentResponseSchema(maxCitations), {
            method: 'jsonMode',
            includeRaw: true,
          })
          .invoke(
            [
              ['system', systemPrompt],
              ['user', correctionUserPrompt],
            ],
            { signal: signal ?? AbortSignal.timeout(18_000) },
          );
      } catch (error) {
        diagnostics?.recordModelCall({
          name: 'citation-correction',
          provider: this.options.ragConfig.chatProvider,
          model: this.options.ragConfig.chatModel,
          status: 'failed',
          attempt: 1,
          durationMs: Date.now() - modelStartedAt,
          inputTokens: null,
          outputTokens: null,
          input: correctionInput,
          output: { error },
        });
        throw error;
      }
    })();
    const usage = usageFromMessages([correction.raw]);
    const raw = extractFinalMessageText([correction.raw]);
    const correctionValue =
      correction.parsed ?? parseJsonObject(raw.text) ?? parseJsonObject(raw.reasoning);
    const recovered = recoverAgentCandidate(correctionValue, maxCitations);
    diagnostics?.recordModelCall({
      name: 'citation-correction',
      provider: this.options.ragConfig.chatProvider,
      model: this.options.ragConfig.chatModel,
      status: 'completed',
      attempt: 1,
      durationMs: Date.now() - modelStartedAt,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      input: correctionInput,
      output: modelMessageForReport(correction.raw),
      metadata: {
        // 纠正只处理越权 ID；被判定的候选引用数量另行记录，便于判断是否需要人工复核。
        candidateCitationCount: candidate.citedChunkIds.length,
        parsed: recovered.candidate !== null,
        citationLimitExceeded: recovered.citationLimitExceeded,
        validationIssues: recovered.validationIssues,
      },
    });
    diagnostics?.recordReasoning(raw.reasoning);
    diagnostics?.recordOutput({ rawText: raw.text });

    return {
      candidate: recovered.candidate ?? candidate,
      usage,
    };
  }

  /**
   * 用已检索到的段落补齐一次依据，供检索有结果但候选回答仍未引用的场景使用。
   *
   * 只允许引用传入的段落 ID；调用方仍会再做一次白名单与引用校验。
   */
  async groundAnswer(input: {
    question: string;
    passages: { chunkId: string; documentTitle: string; content: string }[];
    maxCitations: number;
    signal?: AbortSignal;
    diagnostics?: AiExecutionRecorder;
  }): Promise<AgentAnswerCandidate> {
    const systemPrompt = groundedRescueContext();
    const userPrompt = groundedRescueInput(input.question, input.passages);
    const callInput = {
      kind: 'chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
    input.diagnostics?.recordContext({ systemPrompt, reason: 'grounding-rescue' });
    const startedAt = Date.now();
    try {
      const result = await this.model
        .withStructuredOutput(boundedAgentResponseSchema(input.maxCitations), {
          method: 'jsonMode',
          includeRaw: true,
        })
        .invoke(
          [
            ['system', systemPrompt],
            ['user', userPrompt],
          ],
          { signal: input.signal ?? AbortSignal.timeout(18_000) },
        );
      const raw = extractFinalMessageText([result.raw]);
      const value = result.parsed ?? parseJsonObject(raw.text) ?? parseJsonObject(raw.reasoning);
      const recovered = recoverAgentCandidate(value, input.maxCitations);
      input.diagnostics?.recordModelCall({
        name: 'grounding-rescue',
        provider: this.options.ragConfig.chatProvider,
        model: this.options.ragConfig.chatModel,
        status: 'completed',
        attempt: 1,
        durationMs: Date.now() - startedAt,
        inputTokens: usageFromMessages([result.raw]).inputTokens,
        outputTokens: usageFromMessages([result.raw]).outputTokens,
        input: callInput,
        output: modelMessageForReport(result.raw),
        metadata: {
          passageCount: input.passages.length,
          parsed: recovered.candidate !== null,
          validationIssues: recovered.validationIssues,
        },
      });
      input.diagnostics?.recordReasoning(raw.reasoning);
      input.diagnostics?.recordOutput({ rawText: raw.text });
      return recovered.candidate ?? { answer: '', grounded: false, citedChunkIds: [] };
    } catch (error) {
      input.diagnostics?.recordModelCall({
        name: 'grounding-rescue',
        provider: this.options.ragConfig.chatProvider,
        model: this.options.ragConfig.chatModel,
        status: 'failed',
        attempt: 1,
        durationMs: Date.now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        input: callInput,
        output: { error },
      });
      // 补齐失败不应覆盖原始回答：由调用方按原有降级规则处理。
      return { answer: '', grounded: false, citedChunkIds: [] };
    }
  }
}
