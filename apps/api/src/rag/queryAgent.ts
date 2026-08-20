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
import { AIMessage, HumanMessage, RemoveMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { ChatDeepSeek } from '@langchain/deepseek';
import { createDeepAgent } from 'deepagents';
import { createMiddleware, modelCallLimitMiddleware, toolCallLimitMiddleware } from 'langchain';
import { z } from 'zod';

import type { SourceLocator } from '@echowave/contracts';

import type { ApiConfig } from '../env.ts';
import { extractFinalMessageText, parseJsonObject } from './structuredOutput.ts';

const AgentResponseSchema = z.object({
  answer: z.string(),
  grounded: z.boolean(),
  citedChunkIds: z.array(z.string().uuid()).max(8),
});

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

/**
 * 把 DeepSeek/DeepAgent 的调用约束隐藏在稳定的生成与纠正接口之后。
 */
export class DeepSeekQueryAgent {
  private readonly model: ChatDeepSeek;

  constructor(private readonly options: QueryAgentOptions) {
    // DeepSeek V4 默认可能开启 thinking；显式配置可避免 sampling 与 tool_choice 语义漂移。
    const thinking = options.ragConfig.enableThinking
      ? { type: 'enabled' }
      : { type: 'disabled' };
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
    signal?: AbortSignal;
  }): Promise<AgentExecutionResult> {
    const searchKnowledge = tool(
      async ({ query }) => JSON.stringify(await input.searchKnowledge(query)),
      {
        name: 'search_knowledge',
        description: 'Search the current Chinese knowledge base for source passages that can support the answer.',
        schema: z.object({ query: z.string().min(1).max(2_000) }),
      },
    );

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
        modelCallLimitMiddleware({ runLimit: 3, exitBehavior: 'error' }),
        toolCallLimitMiddleware({ toolName: 'search_knowledge', runLimit: 2, exitBehavior: 'error' }),
      ],
      permissions: [{ operations: ['read', 'write'], paths: ['/**'], mode: 'deny' }],
      systemPrompt: [
        'You are EchoWave\'s Chinese knowledge-base question-answering agent.',
        'You must call search_knowledge before answering and may call it at most twice.',
        'Use only retrieved passages. Never answer from general knowledge or speculate.',
        'If evidence is insufficient, set grounded=false, citedChunkIds=[], and clearly say the knowledge base has insufficient evidence.',
        'When grounded=true, every material claim must contain [1], [2], etc. markers corresponding to citedChunkIds order.',
        'Never call filesystem tools. Do not delegate tasks. Do not expose hidden reasoning.',
        'Return ONLY a single JSON object and nothing else - no markdown fences, no extra text:',
        '{"answer": "<concise Chinese answer with [1], [2] markers when grounded>", "grounded": true|false, "citedChunkIds": ["<uuid>", ...]}',
        'Use only real chunk IDs returned by search_knowledge; when evidence is insufficient use grounded=false and an empty citedChunkIds array.',
      ].join('\n'),
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

    const { text, reasoning } = extractFinalMessageText(result.messages as unknown[]);
    const parsed = parseJsonObject(text) ?? parseJsonObject(reasoning);
    const structured = parsed === null ? null : AgentResponseSchema.safeParse(parsed);
    return {
      candidate: structured?.success
        ? structured.data
        : { answer: '知识库中没有足够依据回答这个问题。', grounded: false, citedChunkIds: [] },
      usage: usageFromMessages(result.messages as unknown[]),
    };
  }

  /**
   * 仅纠正引用 ID，不允许引入新的事实；调用方仍需再次执行白名单校验。
   */
  async correctCitations(
    candidate: AgentAnswerCandidate,
    allowedIds: string[],
    signal?: AbortSignal,
  ): Promise<AgentExecutionResult> {
    const correction = await this.model
      .withStructuredOutput(AgentResponseSchema, { method: 'jsonMode', includeRaw: true })
      .invoke(
        [
          ['system', 'Correct citation IDs only. Do not add facts. Return only the required JSON object with no markdown or extra text.'],
          ['user', `Previous output: ${JSON.stringify(candidate)}\nAllowed IDs: ${JSON.stringify(allowedIds)}`],
        ],
        { signal: signal ?? AbortSignal.timeout(18_000) },
      );

    return {
      candidate: correction.parsed
        ? AgentResponseSchema.parse(correction.parsed)
        : candidate,
      usage: usageFromMessages([correction.raw]),
    };
  }
}
