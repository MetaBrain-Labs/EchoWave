/**
 * DeepSeek 知识问答适配器。
 *
 * 负责把可信回答模块提供的检索函数接入 DeepAgent，并隔离 DeepSeek thinking、
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
import { ChatDeepSeek } from '@langchain/deepseek';
import { createDeepAgent } from 'deepagents';
import { createMiddleware, modelCallLimitMiddleware, toolCallLimitMiddleware } from 'langchain';
import { z } from 'zod';

import type { SourceLocator } from '@echowave/contracts';

import type { AiExecutionRecorder } from '../../ai-observability/executionReporter.ts';
import type { ApiConfig } from '../../config/env.ts';
import { extractFinalMessageText, parseJsonObject } from './structuredOutput.ts';

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

function knowledgeAgentSystemPrompt(maxSearchCalls: number, maxCitations: number): string {
  return [
    "You are EchoWave's Chinese knowledge-base question-answering agent.",
    `You must call search_knowledge before answering and may call it at most ${maxSearchCalls} times.`,
    'Use only retrieved passages. Never answer from general knowledge or speculate.',
    'If a tool message says the search limit was exceeded, stop calling tools and return the best supported final JSON using passages already retrieved.',
    'Do not add a separate search-limit warning; the application adds a stable user-facing notice.',
    'If evidence is insufficient, set grounded=false, citedChunkIds=[], and clearly say the knowledge base has insufficient evidence.',
    'When grounded=true, every material claim must contain [1], [2], etc. markers corresponding to citedChunkIds order.',
    `Select at most ${maxCitations} of the strongest supporting chunks and return no more than ${maxCitations} citedChunkIds.`,
    'Never call filesystem tools. Do not delegate tasks. Do not expose hidden reasoning.',
    'Return ONLY a single JSON object and nothing else - no markdown fences, no extra text:',
    '{"answer": "<concise Chinese answer with [1], [2] markers when grounded>", "grounded": true|false, "citedChunkIds": ["<uuid>", ...]}',
    'Return valid JSON: escape ASCII double quotes inside the answer string, or use Chinese quotation marks instead.',
    'Use only real chunk IDs returned by search_knowledge; when evidence is insufficient use grounded=false and an empty citedChunkIds array.',
  ].join('\n');
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

/** DeepSeek 主回答或纠正调用产生的 token 用量。 */
export type AgentTokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

/** DeepSeek 适配器返回给可信回答模块的候选结果。 */
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
    ApiConfig['rag'],
    'deepSeekApiKey' | 'deepSeekBaseUrl' | 'deepSeekChatModel' | 'enableThinking'
  >;
  checkpointer: BaseCheckpointSaver;
  /** 测试接缝：使用脚本化 HTTP 响应替代真实 DeepSeek 请求。 */
  fetchImplementation?: typeof fetch;
};

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
 * 把 DeepSeek/DeepAgent 的调用约束隐藏在稳定的生成与纠正接口之后。
 */
export class DeepSeekQueryAgent {
  private readonly model: ChatDeepSeek;

  constructor(private readonly options: QueryAgentOptions) {
    // DeepSeek V4 默认可能开启 thinking；显式配置可避免 sampling 与 tool_choice 语义漂移。
    const thinking = options.ragConfig.enableThinking ? { type: 'enabled' } : { type: 'disabled' };
    this.model = new ChatDeepSeek({
      apiKey: options.ragConfig.deepSeekApiKey,
      model: options.ragConfig.deepSeekChatModel,
      temperature: 0,
      maxTokens: 1_200,
      maxRetries: 1,
      timeout: 18_000,
      configuration: {
        baseURL: options.ragConfig.deepSeekBaseUrl,
        ...(options.fetchImplementation ? { fetch: options.fetchImplementation } : {}),
      },
      modelKwargs: { thinking },
    });
  }

  /**
   * 执行一次带检索工具的回答生成，只返回尚未通过引用白名单确认的候选结果。
   */
  async generate(input: {
    question: string;
    threadId: string;
    searchKnowledge: (query: string) => Promise<AgentSearchResult>;
    maxSearchCalls: number;
    maxCitations: number;
    signal?: AbortSignal;
    diagnostics?: AiExecutionRecorder;
  }): Promise<AgentGenerationResult> {
    const searchKnowledge = tool(
      async ({ query }) => JSON.stringify(await input.searchKnowledge(query)),
      {
        name: 'search_knowledge',
        description:
          'Search the current Chinese knowledge base for source passages that can support the answer.',
        schema: z.object({ query: z.string().min(1).max(2_000) }),
      },
    );

    const responseSchema = boundedAgentResponseSchema(input.maxCitations);
    const systemPrompt = knowledgeAgentSystemPrompt(input.maxSearchCalls, input.maxCitations);
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
    const modelStartedAt = Date.now();
    const result = await (async () => {
      try {
        return await agent.invoke(
          { messages: [{ role: 'user', content: input.question }] },
          {
            configurable: { thread_id: input.threadId },
            // 中间件钩子会占用多个 graph superstep；真实工作仍由模型与工具调用上限约束。
            recursionLimit: 32,
            signal: input.signal ?? AbortSignal.timeout(20_000),
          },
        );
      } catch (error) {
        input.diagnostics?.recordModelCall({
          name: 'knowledge-answer-generation',
          provider: 'deepseek',
          model: this.options.ragConfig.deepSeekChatModel,
          status: 'failed',
          durationMs: Date.now() - modelStartedAt,
        });
        throw error;
      }
    })();

    const resultMessages = result.messages as BaseMessage[];
    const { text, reasoning } = extractFinalMessageText(resultMessages);
    const parsed = parseJsonObject(text) ?? parseJsonObject(reasoning);
    let recovered = recoverAgentCandidate(parsed, input.maxCitations);
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
    input.diagnostics?.recordModelCall({
      name: 'knowledge-answer-generation',
      provider: 'deepseek',
      model: this.options.ragConfig.deepSeekChatModel,
      status: 'completed',
      durationMs: Date.now() - modelStartedAt,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      metadata: {
        structuredOutputRecovered: recovered.candidate !== null,
        citationLimitExceeded: recovered.citationLimitExceeded,
        validationIssues: recovered.validationIssues,
        retrievalLimited: blockedRetrievalCalls > 0,
        blockedRetrievalCalls,
      },
    });
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
      const finalizationPrompt = [
        blockedRetrievalCalls > 0
          ? 'The search limit has been reached. Do not call any tools.'
          : 'The previous answer was not valid structured JSON. Do not call any tools or search again.',
        'Using only the search_knowledge passages and previous answer in the current run below, repair and return the best supported final JSON.',
        'Do not use general knowledge or add a search-limit warning; the application adds the warning.',
        'Return ONLY a single JSON object and nothing else:',
        '{"answer": "<concise Chinese answer with citation markers when grounded>", "grounded": true|false, "citedChunkIds": ["<retrieved chunk uuid>", ...]}',
        `Select at most ${input.maxCitations} of the strongest supporting chunks and return no more than ${input.maxCitations} citedChunkIds.`,
        'Return valid JSON: escape ASCII double quotes inside the answer string, or use Chinese quotation marks instead.',
        'Use only chunk IDs already returned in this run. If evidence is insufficient, use grounded=false and an empty citedChunkIds array.',
      ].join('\n');
      input.diagnostics?.recordContext({
        systemPrompt: finalizationPrompt,
        reason: recoveryReason,
      });
      const finalizationStartedAt = Date.now();
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
            provider: 'deepseek',
            model: this.options.ragConfig.deepSeekChatModel,
            status: 'failed',
            durationMs: Date.now() - finalizationStartedAt,
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
        provider: 'deepseek',
        model: this.options.ragConfig.deepSeekChatModel,
        status: 'completed',
        durationMs: Date.now() - finalizationStartedAt,
        inputTokens: finalizationUsage.inputTokens,
        outputTokens: finalizationUsage.outputTokens,
        metadata: {
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
   * 仅纠正引用 ID，不允许引入新的事实；调用方仍需再次执行白名单校验。
   */
  async correctCitations(
    candidate: AgentAnswerCandidate,
    allowedIds: string[],
    maxCitations: number,
    signal?: AbortSignal,
    diagnostics?: AiExecutionRecorder,
  ): Promise<AgentExecutionResult> {
    const systemPrompt = `Correct and compact citations only. Do not add facts. Keep at most ${maxCitations} of the strongest allowed citation IDs, update citation markers to match their order, and return only the required valid JSON object with no markdown or extra text. Escape ASCII double quotes inside the answer string, or use Chinese quotation marks instead.`;
    diagnostics?.recordContext({ systemPrompt, candidate, allowedIds });
    const modelStartedAt = Date.now();
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
              [
                'user',
                `Previous output: ${JSON.stringify(candidate)}\nAllowed IDs: ${JSON.stringify(allowedIds)}`,
              ],
            ],
            { signal: signal ?? AbortSignal.timeout(18_000) },
          );
      } catch (error) {
        diagnostics?.recordModelCall({
          name: 'citation-correction',
          provider: 'deepseek',
          model: this.options.ragConfig.deepSeekChatModel,
          status: 'failed',
          durationMs: Date.now() - modelStartedAt,
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
      provider: 'deepseek',
      model: this.options.ragConfig.deepSeekChatModel,
      status: 'completed',
      durationMs: Date.now() - modelStartedAt,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      metadata: {
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
}
