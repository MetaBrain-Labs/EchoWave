/** Executes grounded DeepAgent answers with a single tenant-scoped read-only retrieval tool. */
import { AIMessage, HumanMessage, RemoveMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { ChatDeepSeek } from '@langchain/deepseek';
import { createDeepAgent } from 'deepagents';
import { createMiddleware, modelCallLimitMiddleware, toolCallLimitMiddleware, toolStrategy } from 'langchain';
import { z } from 'zod';

import { RagQueryResponseSchema, type RagQueryResponse } from '@echowave/contracts';

import type { ApiConfig } from '../env.ts';
import { OpenRouterEmbeddings } from './openRouterEmbeddings.ts';
import { RagRepository, type RetrievalChunk } from './repository.ts';

const AgentResponseSchema = z.object({
  answer: z.string(),
  grounded: z.boolean(),
  citedChunkIds: z.array(z.string().uuid()).max(8),
});

const shortConversationMiddleware = createMiddleware({
  name: 'KeepSixConversationTurns',
  beforeAgent: (state) => {
    const messages = state.messages;
    const humanIndexes = messages
      .map((message, index) => message instanceof HumanMessage ? index : -1)
      .filter((index) => index >= 0);
    const keepFrom = humanIndexes.at(-6) ?? 0;
    const removals = messages
      .slice(0, keepFrom)
      .flatMap((message) => message.id ? [new RemoveMessage({ id: message.id })] : []);
    return removals.length ? { messages: removals } : undefined;
  },
});

export class QueryModelError extends Error {
  constructor(
    public readonly code: 'MODEL_TIMEOUT' | 'MODEL_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'QueryModelError';
  }
}

type QueryAgentOptions = {
  repository: RagRepository;
  embeddings: OpenRouterEmbeddings;
  ragConfig: ApiConfig['rag'];
  checkpointer: BaseCheckpointSaver;
};

function usageFromMessages(messages: unknown[]): { inputTokens: number; outputTokens: number } {
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

export class KnowledgeQueryAgent {
  private readonly model: ChatDeepSeek;

  constructor(private readonly options: QueryAgentOptions) {
    this.model = new ChatDeepSeek({
      apiKey: options.ragConfig.deepSeekApiKey,
      model: options.ragConfig.deepSeekChatModel,
      temperature: 0,
      maxTokens: 1_200,
      maxRetries: 1,
      timeout: 18_000,
      configuration: { baseURL: options.ragConfig.deepSeekBaseUrl },
    });
  }

  async query(knowledgeBaseId: string, question: string, conversationId?: string): Promise<RagQueryResponse> {
    const startedAt = Date.now();
    const conversation = await this.options.repository.getOrCreateConversation(knowledgeBaseId, conversationId);
    const runId = await this.options.repository.beginRun({
      knowledgeBaseId,
      conversationId: conversation.id,
      question,
      embeddingModel: this.options.ragConfig.embeddingModel,
      chatModel: this.options.ragConfig.deepSeekChatModel,
      chatProvider: 'deepseek',
    });
    const retrieved = new Map<string, RetrievalChunk>();
    let retrievalCalls = 0;
    let embeddingTokens = 0;

    const searchKnowledge = tool(
      async ({ query }) => {
        retrievalCalls += 1;
        if (retrievalCalls > 2) return JSON.stringify({ error: '本次回答已达到两次检索上限。', chunks: [] });
        const embedded = await this.options.embeddings.embedQueryWithUsage(query);
        embeddingTokens += embedded.tokens;
        const chunks = await this.options.repository.search(knowledgeBaseId, embedded.vectors[0] ?? []);
        for (const chunk of chunks) retrieved.set(chunk.id, chunk);
        return JSON.stringify({
          chunks: chunks.map((chunk) => ({
            chunkId: chunk.id,
            documentTitle: chunk.documentTitle,
            locator: chunk.locator,
            content: chunk.content,
          })),
        });
      },
      {
        name: 'search_knowledge',
        description: '在当前中文知识库中检索回答用户问题所需的原文证据。仅返回可引用的文档块。',
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
      responseFormat: toolStrategy(AgentResponseSchema, { handleError: false }),
      systemPrompt: [
        'You are EchoWave\'s Chinese knowledge-base question-answering agent.',
        'You must call search_knowledge before answering and may call it at most twice.',
        'Use only retrieved passages. Never answer from general knowledge or speculate.',
        'If evidence is insufficient, set grounded=false, citedChunkIds=[], and clearly say the knowledge base has insufficient evidence.',
        'When grounded=true, every material claim must contain [1], [2], etc. markers corresponding to citedChunkIds order.',
        'Never call filesystem tools. Do not delegate tasks. Do not expose hidden reasoning.',
        'Return concise Chinese text and only real chunk IDs returned by search_knowledge.',
      ].join('\n'),
    });

    const invoke = async (message: string) =>
      agent.invoke(
        { messages: [{ role: 'user', content: message }] },
        { configurable: { thread_id: conversation.threadId }, recursionLimit: 9, signal: AbortSignal.timeout(20_000) },
      );

    try {
      let result = await invoke(question);
      let structured = AgentResponseSchema.parse(result.structuredResponse);
      let validIds = structured.citedChunkIds.filter((id) => retrieved.has(id));
      let correctionUsage = { inputTokens: 0, outputTokens: 0 };
      if (validIds.length !== structured.citedChunkIds.length) {
        const correction = await this.model.withStructuredOutput(AgentResponseSchema, { includeRaw: true }).invoke([
          ['system', 'Correct citation IDs only. Do not add facts. Return the required structured output.'],
          ['user', `Previous output: ${JSON.stringify(structured)}\nAllowed IDs: ${JSON.stringify([...retrieved.keys()])}`],
        ], { signal: AbortSignal.timeout(18_000) });
        structured = AgentResponseSchema.parse(correction.parsed);
        correctionUsage = usageFromMessages([correction.raw]);
        validIds = structured.citedChunkIds.filter((id) => retrieved.has(id));
        if (validIds.length !== structured.citedChunkIds.length) {
          structured = {
            answer: '知识库中没有足够依据回答这个问题。',
            grounded: false,
            citedChunkIds: [],
          };
          validIds = [];
        }
      }
      if (!structured.grounded || validIds.length === 0) {
        structured = {
          answer: '知识库中没有足够依据回答这个问题。',
          grounded: false,
          citedChunkIds: [],
        };
        validIds = [];
      }
      const agentUsage = usageFromMessages(result.messages as unknown[]);
      const usage = {
        inputTokens: agentUsage.inputTokens + correctionUsage.inputTokens,
        outputTokens: agentUsage.outputTokens + correctionUsage.outputTokens,
      };
      const response = RagQueryResponseSchema.parse({
        conversationId: conversation.id,
        answer: structured.answer,
        grounded: structured.grounded,
        citations: validIds.map((id, index) => {
          const chunk = retrieved.get(id);
          if (!chunk) throw new Error('Validated citation disappeared.');
          return {
            number: index + 1,
            documentId: chunk.documentId,
            documentTitle: chunk.documentTitle,
            chunkId: chunk.id,
            locator: chunk.locator,
            excerpt: chunk.content.slice(0, 320),
          };
        }),
        usage: { embeddingTokens, ...usage },
      });
      await this.options.repository.completeRun(runId, {
        answer: response.answer,
        grounded: response.grounded,
        citedChunkIds: validIds,
        embeddingTokens,
        ...usage,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      await this.options.repository.failRun(runId, Date.now() - startedAt).catch(() => undefined);
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new QueryModelError('MODEL_TIMEOUT', '问答模型响应超时，请稍后重试。');
      }
      if (error instanceof QueryModelError) throw error;
      console.error('Knowledge query failed', { conversationId: conversation.id, knowledgeBaseId });
      throw new QueryModelError('MODEL_UNAVAILABLE', '问答模型暂时不可用，请稍后重试。');
    }
  }
}
