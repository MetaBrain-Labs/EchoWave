/**
 * 可信知识回答模块。
 *
 * 负责一次知识库问答从会话建立、运行审计、受限检索、模型生成、引用校验到最终持久化
 * 的完整生命周期，并拥有过期会话与 LangGraph checkpoint 的清理顺序。
 *
 * Responsibilities:
 * - 通过单一 answer 接口产出经过运行时校验的最终回答。
 * - 保证模型引用只能来自本次检索结果。
 * - 保证已创建的问答运行最终进入完成或失败状态。
 * - 在 dispose 时停止并收敛过期会话清理任务。
 *
 * Notes:
 * - 本模块只返回完整 JSON，不暴露未验证的模型增量文本。
 * - PostgreSQL、embedding、模型和 checkpoint 仅作为内部可替换接缝。
 */
import {
  RagQueryRequestSchema,
  RagQueryResponseSchema,
  type RagQueryRequest,
  type RagQueryResponse,
} from "@echowave/contracts";

import type { ApiConfig } from "../../config/env.ts";
import type { OpenRouterEmbeddings } from "../embeddings/openRouterEmbeddings.ts";
import type { ConversationRepository } from "../persistence/conversationRepository.ts";
import { RagRepositoryError } from "../persistence/errors.ts";
import type {
  KnowledgeRepository,
  RetrievalChunk,
} from "../persistence/knowledgeRepository.ts";
import type { DeepSeekQueryAgent } from "./deepSeekQueryAgent.ts";

const INSUFFICIENT_EVIDENCE = "知识库中没有足够依据回答这个问题。";
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/** 调用可信回答模块所需的最小命令。 */
export type KnowledgeAnswerCommand = {
  knowledgeBaseId: string;
  request: RagQueryRequest;
};

/** 调用方可见的可信回答接口。 */
export type KnowledgeAnswerModule = {
  answer(command: KnowledgeAnswerCommand): Promise<RagQueryResponse>;
  dispose(): Promise<void>;
};

/** 可由 Hono 稳定映射的模型侧错误。 */
export class KnowledgeAnswerError extends Error {
  constructor(
    public readonly code: "MODEL_TIMEOUT" | "MODEL_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeAnswerError";
  }
}

type KnowledgeAnswerEmbeddings = Pick<
  OpenRouterEmbeddings,
  "embedQueryWithUsage"
>;
type KnowledgeAnswerAgent = Pick<
  DeepSeekQueryAgent,
  "generate" | "correctCitations"
>;
type KnowledgeAnswerCheckpointer = {
  deleteThread(threadId: string): Promise<void>;
};
type ScheduleCleanup = (task: () => void, intervalMs: number) => () => void;

type KnowledgeAnswerOptions = {
  knowledgeRepository: Pick<KnowledgeRepository, "search">;
  conversationRepository: ConversationRepository;
  embeddings: KnowledgeAnswerEmbeddings;
  agent: KnowledgeAnswerAgent;
  checkpointer: KnowledgeAnswerCheckpointer;
  ragConfig: Pick<ApiConfig["rag"], "embeddingModel" | "deepSeekChatModel">;
  scheduleCleanup?: ScheduleCleanup;
  now?: () => number;
};

const scheduleCleanup: ScheduleCleanup = (task, intervalMs) => {
  const timer = setInterval(task, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
};

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/**
 * 创建拥有回答执行与会话清理生命周期的深模块。
 */
export function createKnowledgeAnswerModule(
  options: KnowledgeAnswerOptions,
): KnowledgeAnswerModule {
  return new DefaultKnowledgeAnswerModule(options);
}

class DefaultKnowledgeAnswerModule implements KnowledgeAnswerModule {
  private readonly cancelCleanup: () => void;
  private cleanupPromise?: Promise<void>;
  private disposed = false;

  constructor(private readonly options: KnowledgeAnswerOptions) {
    this.cancelCleanup = (options.scheduleCleanup ?? scheduleCleanup)(
      () => void this.runCleanup(),
      CLEANUP_INTERVAL_MS,
    );
    // 启动即清理一次，避免必须等待首个 24 小时周期才释放过期 checkpoint。
    void this.runCleanup();
  }

  /**
   * 执行一次完整问答；只有最终响应已通过引用校验并完成审计后才向调用方返回。
   */
  async answer(command: KnowledgeAnswerCommand): Promise<RagQueryResponse> {
    if (this.disposed) throw new Error("Knowledge answer module is disposed.");

    const request = RagQueryRequestSchema.parse(command.request);
    const startedAt = (this.options.now ?? Date.now)();
    const conversation =
      await this.options.conversationRepository.getOrCreateConversation(
        command.knowledgeBaseId,
        request.conversationId,
      );
    const runId = await this.options.conversationRepository.beginRun({
      knowledgeBaseId: command.knowledgeBaseId,
      conversationId: conversation.id,
      question: request.question,
      embeddingModel: this.options.ragConfig.embeddingModel,
      chatModel: this.options.ragConfig.deepSeekChatModel,
      chatProvider: "deepseek",
    });
    const retrieved = new Map<string, RetrievalChunk>();
    let retrievalCalls = 0;
    let embeddingTokens = 0;
    const signal = AbortSignal.timeout(20_000);

    try {
      const generated = await this.options.agent.generate({
        question: request.question,
        threadId: conversation.threadId,
        signal,
        searchKnowledge: async (query) => {
          retrievalCalls += 1;
          if (retrievalCalls > 2) {
            return {
              error: "The retrieval limit for this answer has been reached.",
              chunks: [],
            };
          }
          const embedded =
            await this.options.embeddings.embedQueryWithUsage(query);
          embeddingTokens += embedded.tokens;
          const chunks = await this.options.knowledgeRepository.search(
            command.knowledgeBaseId,
            embedded.vectors[0] ?? [],
          );
          for (const chunk of chunks) retrieved.set(chunk.id, chunk);
          return {
            chunks: chunks.map((chunk) => ({
              chunkId: chunk.id,
              documentTitle: chunk.documentTitle,
              locator: chunk.locator,
              content: chunk.content,
            })),
          };
        },
      });

      let candidate = generated.candidate;
      let validIds = candidate.citedChunkIds.filter((id) => retrieved.has(id));
      let correctionUsage = { inputTokens: 0, outputTokens: 0 };

      if (validIds.length !== candidate.citedChunkIds.length) {
        const corrected = await this.options.agent.correctCitations(
          candidate,
          [...retrieved.keys()],
          signal,
        );
        candidate = corrected.candidate;
        correctionUsage = corrected.usage;
        validIds = candidate.citedChunkIds.filter((id) => retrieved.has(id));
      }

      // 模型声明无依据、未引用证据或仍引用越权 ID 时，统一降级为稳定拒答。
      if (
        !candidate.grounded ||
        validIds.length === 0 ||
        validIds.length !== candidate.citedChunkIds.length
      ) {
        candidate = {
          answer: INSUFFICIENT_EVIDENCE,
          grounded: false,
          citedChunkIds: [],
        };
        validIds = [];
      }

      const usage = {
        inputTokens: generated.usage.inputTokens + correctionUsage.inputTokens,
        outputTokens:
          generated.usage.outputTokens + correctionUsage.outputTokens,
      };
      const response = RagQueryResponseSchema.parse({
        conversationId: conversation.id,
        answer: candidate.answer,
        grounded: candidate.grounded,
        citations: validIds.map((id, index) => {
          const chunk = retrieved.get(id);
          if (!chunk) throw new Error("Validated citation disappeared.");
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

      await this.options.conversationRepository.completeRun(runId, {
        answer: response.answer,
        grounded: response.grounded,
        citedChunkIds: validIds,
        embeddingTokens,
        ...usage,
        durationMs: (this.options.now ?? Date.now)() - startedAt,
      });
      return response;
    } catch (error) {
      // 审计失败是次生故障，不能覆盖触发失败的原始异常。
      await this.options.conversationRepository
        .failRun(runId, (this.options.now ?? Date.now)() - startedAt)
        .catch(() => undefined);
      if (isTimeout(error)) {
        throw new KnowledgeAnswerError(
          "MODEL_TIMEOUT",
          "问答模型响应超时，请稍后重试。",
        );
      }
      if (
        error instanceof KnowledgeAnswerError ||
        error instanceof RagRepositoryError
      )
        throw error;
      console.error("Knowledge answer failed", error, {
        conversationId: conversation.id,
        knowledgeBaseId: command.knowledgeBaseId,
      });
      throw new KnowledgeAnswerError(
        "MODEL_UNAVAILABLE",
        "问答模型暂时不可用，请稍后重试。",
      );
    }
  }

  /**
   * 停止周期清理并等待正在执行的清理任务结束；重复调用保持幂等。
   */
  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.cancelCleanup();
    }
    await this.cleanupPromise;
  }

  private runCleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    const running = this.cleanupExpiredConversations().catch(
      (error: unknown) => {
        console.error("Failed to clean expired RAG conversations", error);
      },
    );
    this.cleanupPromise = running.finally(() => {
      this.cleanupPromise = undefined;
    });
    return this.cleanupPromise;
  }

  private async cleanupExpiredConversations(): Promise<void> {
    for (const conversation of await this.options.conversationRepository.listExpiredConversations()) {
      try {
        // checkpoint 必须先删除；随后数据库外键才能安全清理 conversation 与关联 run。
        await this.options.checkpointer.deleteThread(conversation.threadId);
        await this.options.conversationRepository.deleteExpiredConversation(
          conversation.id,
        );
      } catch (error) {
        console.error("Failed to clean expired RAG conversation", error, {
          conversationId: conversation.id,
        });
      }
    }
  }
}
