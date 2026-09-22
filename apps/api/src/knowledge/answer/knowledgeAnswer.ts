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
} from '@echowave/contracts';

import {
  noOpAiExecutionReporter,
  type AiExecutionReporter,
} from '../../ai-observability/executionReporter.ts';
import type { RagConfig } from '../../config/workspace.ts';
import {
  EmbeddingProviderError,
  type DashScopeEmbeddings,
} from '../embeddings/dashScopeEmbeddings.ts';
import type { ConversationRepository } from '../persistence/conversationRepository.ts';
import { RagRepositoryError } from '../persistence/errors.ts';
import type { KnowledgeSearchPort } from '../retrieval/port.ts';
import {
  CategoryRetrievalPolicy,
  isTestSampleQuestion,
  type CategorySearchFilter,
} from '../retrieval/categoryPolicy.ts';
import { readRerankDisclosure } from '../retrieval/rerankDisclosure.ts';
import type { RetrievalChunk } from '../retrieval/types.ts';
import type { FrozenRerankRuntime } from '../retrieval/settingsService.ts';
import { resolveCitationMarkers } from './citationMarkers.ts';
import type { KnowledgeQueryAgent } from './knowledgeQueryAgent.ts';

const INSUFFICIENT_EVIDENCE = '知识库中没有足够依据回答这个问题。';
const RETRIEVAL_LIMIT_NOTICE =
  '提示：本轮检索已达到上限，回答仅基于当前已检索到的内容，证据可能不完整。';
const MAX_SEARCH_CALLS = 4;
/** 补齐依据时最多回传的段落数，避免超出模型上下文与回答预算。 */
const MAX_GROUNDING_PASSAGES = 8;
/**
 * 引用数量的安全上限，只用于防御异常输出。
 *
 * 这里不再是"质量预算"：正文标记与引用清单必须一一对应，裁剪合法引用会让正文出现
 * 无来源的 [n]，因此合法引用一律保留，长清单由移动端折叠展开承担。
 */
const MAX_CITATIONS = 24;
const KNOWLEDGE_ANSWER_TIMEOUT_MS = 45_000;
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
    public readonly code: 'MODEL_TIMEOUT' | 'MODEL_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeAnswerError';
  }
}

type KnowledgeAnswerEmbeddings = Pick<DashScopeEmbeddings, 'embedQueryWithUsage'>;
type KnowledgeAnswerAgent = Pick<
  KnowledgeQueryAgent,
  'generate' | 'correctCitations' | 'groundAnswer'
>;
type KnowledgeAnswerCheckpointer = {
  deleteThread(threadId: string): Promise<void>;
};
type ScheduleCleanup = (task: () => void, intervalMs: number) => () => void;

function disabledRerankRuntime(): FrozenRerankRuntime {
  return { enabled: false, revision: 1, bindingRevisionId: null, model: null };
}

type KnowledgeAnswerRuntime = {
  embeddings: KnowledgeAnswerEmbeddings;
  agent: KnowledgeAnswerAgent;
  ragConfig: Pick<RagConfig, 'embeddingModel' | 'chatModel' | 'chatProvider'>;
  embeddingBindingRevisionId: string | null;
  chatBindingRevisionId: string | null;
  rerank: FrozenRerankRuntime;
};

type KnowledgeAnswerStaticRuntimeOptions = {
  embeddings: KnowledgeAnswerEmbeddings;
  agent: KnowledgeAnswerAgent;
  ragConfig: Pick<RagConfig, 'embeddingModel' | 'chatModel' | 'chatProvider'>;
  resolveRuntime?: never;
};

type KnowledgeAnswerDynamicRuntimeOptions = {
  resolveRuntime: () => Promise<KnowledgeAnswerRuntime>;
  embeddings?: never;
  agent?: never;
  ragConfig?: never;
};

type KnowledgeAnswerOptions = {
  knowledgeRepository: KnowledgeSearchPort;
  conversationRepository: ConversationRepository;
  checkpointer: KnowledgeAnswerCheckpointer;
  reporter?: AiExecutionReporter;
  scheduleCleanup?: ScheduleCleanup;
  now?: () => number;
  createAbortSignal?: (timeoutMs: number) => AbortSignal;
} & (KnowledgeAnswerStaticRuntimeOptions | KnowledgeAnswerDynamicRuntimeOptions);

const scheduleCleanup: ScheduleCleanup = (task, intervalMs) => {
  const timer = setInterval(task, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
};

function isTimeout(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) ||
    (error instanceof EmbeddingProviderError && error.code === 'MODEL_TIMEOUT')
  );
}

function appendRetrievalLimitNotice(answer: string): string {
  return answer.includes(RETRIEVAL_LIMIT_NOTICE)
    ? answer
    : `${answer}\n\n${RETRIEVAL_LIMIT_NOTICE}`;
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
    if (this.disposed) throw new Error('Knowledge answer module is disposed.');

    const request = RagQueryRequestSchema.parse(command.request);
    const resolvedRuntime = this.options.resolveRuntime
      ? await this.options.resolveRuntime()
      : {
          embeddings: this.options.embeddings,
          agent: this.options.agent,
          ragConfig: this.options.ragConfig,
          embeddingBindingRevisionId: null,
          chatBindingRevisionId: null,
          rerank: disabledRerankRuntime(),
        };
    // 兼容迁移期间的旧调用方；生产动态运行时始终显式提供冻结设置。
    const runtime: KnowledgeAnswerRuntime = {
      ...resolvedRuntime,
      rerank: resolvedRuntime.rerank ?? disabledRerankRuntime(),
    };
    const now = this.options.now ?? Date.now;
    /**
     * 本次检索范围：路由知识库始终参与，请求可追加同租户的其他知识库。
     *
     * 去重且按字典序规范化，保证同一集合的审计与结果稳定；单库时保持原有检索预算。
     */
    const requestedIds = [
      ...new Set([command.knowledgeBaseId, ...(request.knowledgeBaseIds ?? [])]),
    ].sort();
    const categoryCatalogue = (await this.options.knowledgeRepository.availableCategories?.(
      requestedIds,
    )) ?? { categories: [], versions: [] };
    /**
     * 只有真实存在且未删除的知识库才会进入检索范围；越权或已删除的 ID 直接拒绝。
     *
     * `availableCategories` 只为存在且未删除的知识库返回版本行，因此版本集合同时充当
     * “该知识库可检索”的判定依据，并让跨库检索集合与审计快照保持一致。
     */
    const searchBaseIds = categoryCatalogue.versions.map((entry) => entry.id);
    if (!searchBaseIds.length) {
      throw new RagRepositoryError('NOT_FOUND', '知识库不存在或已删除。');
    }
    // 请求中任何一个越权或已删除的知识库都拒绝整次检索，避免静默缩小范围。
    if (searchBaseIds.length !== requestedIds.length) {
      const resolved = new Set(searchBaseIds);
      const missing = requestedIds.filter((id) => !resolved.has(id));
      console.warn('Knowledge answer rejected unknown knowledge bases', { missing });
      throw new RagRepositoryError('NOT_FOUND', '知识库不存在或已删除。');
    }
    const crossBase = searchBaseIds.length > 1;
    let categoryPolicy: CategoryRetrievalPolicy;
    try {
      categoryPolicy = new CategoryRetrievalPolicy(
        categoryCatalogue.categories,
        request.categoryIds,
        isTestSampleQuestion(request.question),
      );
    } catch {
      throw new RagRepositoryError('CONFLICT', '类别不属于当前知识库检索范围，请刷新后重试。');
    }
    const retrievalAudit: Record<string, unknown>[] = [];
    const queryEmbeddings = new Map<
      string,
      Awaited<ReturnType<KnowledgeAnswerEmbeddings['embedQueryWithUsage']>>
    >();
    const startedAt = now();
    const report = (this.options.reporter ?? noOpAiExecutionReporter).start({
      kind: 'rag-answer',
      name: 'EchoWave trusted knowledge answer',
      metadata: {
        knowledgeBaseId: command.knowledgeBaseId,
        knowledgeBaseIds: searchBaseIds,
        crossBase,
        requestedConversationId: request.conversationId,
        questionLength: request.question.length,
        embeddingModel: runtime.ragConfig.embeddingModel,
        chatModel: runtime.ragConfig.chatModel,
        chatProvider: runtime.ragConfig.chatProvider,
        embeddingBindingRevisionId: runtime.embeddingBindingRevisionId,
        chatBindingRevisionId: runtime.chatBindingRevisionId,
        rerankEnabled: runtime.rerank.enabled,
        rerankerModel: runtime.rerank.model,
        rerankBindingRevisionId: runtime.rerank.bindingRevisionId,
      },
    });
    report.recordContext({ question: request.question });

    const conversationStartedAt = now();
    report.recordStep({ name: 'conversation', status: 'started' });
    let conversation;
    try {
      conversation = await this.options.conversationRepository.getOrCreateConversation(
        command.knowledgeBaseId,
        request.conversationId,
      );
      report.recordMetadata({
        conversationId: conversation.id,
        threadId: conversation.threadId,
      });
      report.recordStep({
        name: 'conversation',
        status: 'completed',
        durationMs: now() - conversationStartedAt,
      });
    } catch (error) {
      report.recordStep({
        name: 'conversation',
        status: 'failed',
        durationMs: now() - conversationStartedAt,
      });
      await report.finish({ status: 'failed', error });
      throw error;
    }

    const auditStartedAt = now();
    report.recordStep({ name: 'audit-begin', status: 'started' });
    let runId: string;
    try {
      runId = await this.options.conversationRepository.beginRun({
        categorySnapshot: categoryCatalogue.versions,
        knowledgeBaseId: command.knowledgeBaseId,
        knowledgeBaseIds: searchBaseIds,
        conversationId: conversation.id,
        question: request.question,
        embeddingModel: runtime.ragConfig.embeddingModel,
        chatModel: runtime.ragConfig.chatModel,
        chatProvider: runtime.ragConfig.chatProvider,
        embeddingBindingRevisionId: runtime.embeddingBindingRevisionId,
        chatBindingRevisionId: runtime.chatBindingRevisionId,
        rerankEnabled: runtime.rerank.enabled,
        rerankerModel: runtime.rerank.model,
        rerankBindingRevisionId: runtime.rerank.bindingRevisionId,
      });
      report.recordMetadata({ ragRunId: runId });
      report.recordStep({
        name: 'audit-begin',
        status: 'completed',
        durationMs: now() - auditStartedAt,
      });
    } catch (error) {
      report.recordStep({
        name: 'audit-begin',
        status: 'failed',
        durationMs: now() - auditStartedAt,
      });
      await report.finish({ status: 'failed', error });
      throw error;
    }
    const retrieved = new Map<string, RetrievalChunk>();
    let retrievalCalls = 0;
    let retrievalLimited = false;
    let blockedRetrievalCalls = 0;
    let embeddingTokens = 0;
    let rerankTokens = 0;
    let rerankStatus: 'applied' | 'disabled' | 'fallback' = runtime.rerank.enabled
      ? 'applied'
      : 'disabled';
    const signal = (this.options.createAbortSignal ?? AbortSignal.timeout)(
      KNOWLEDGE_ANSWER_TIMEOUT_MS,
    );

    try {
      const generationStartedAt = now();
      report.recordStep({ name: 'agent-generate', status: 'started' });
      let generated;
      try {
        generated = await runtime.agent.generate({
          categories: categoryCatalogue.categories.filter(
            (item) => item.active && (categoryPolicy.includeTestSamples || item.key !== 'test'),
          ),
          explicitCategoryIds: request.categoryIds,
          question: request.question,
          threadId: conversation.threadId,
          signal,
          diagnostics: report,
          maxSearchCalls: MAX_SEARCH_CALLS,
          maxCitations: MAX_CITATIONS,
          searchKnowledge: async (query, choice) => {
            const retrievalStartedAt = now();
            if (retrievalCalls >= MAX_SEARCH_CALLS) {
              retrievalLimited = true;
              blockedRetrievalCalls += 1;
              const limited = {
                error:
                  'The retrieval limit for this answer has been reached. Use already retrieved passages and return the final JSON without calling search again.',
                chunks: [],
              };
              report.recordToolCall({
                name: 'search_knowledge',
                status: 'failed',
                durationMs: now() - retrievalStartedAt,
                summary: {
                  reason: 'run-limit',
                  limit: MAX_SEARCH_CALLS,
                  blockedCalls: 1,
                },
                input: { query },
                output: limited,
              });
              return limited;
            }
            const retrievalCall = retrievalCalls + 1;
            retrievalCalls = retrievalCall;
            report.recordStep({
              name: 'retrieve-knowledge',
              status: 'started',
              metadata: { call: retrievalCall },
            });

            try {
              let filter: CategorySearchFilter;
              try {
                filter = categoryPolicy.resolve(query, choice);
              } catch {
                report.recordStep({
                  name: 'retrieve-knowledge',
                  status: 'failed',
                  durationMs: now() - retrievalStartedAt,
                  metadata: { call: retrievalCall, reason: 'invalid-category-scope' },
                });
                return {
                  chunks: [],
                  error:
                    'Select category IDs from the allowed catalogue. Expansion is permitted only once and never for an explicit filter.',
                };
              }
              const embeddingStartedAt = now();
              let embedded = queryEmbeddings.get(query);
              if (!embedded) {
                try {
                  embedded = await runtime.embeddings.embedQueryWithUsage(query, signal);
                  report.recordModelCall({
                    name: 'query-embedding',
                    provider: embedded.provider,
                    model: embedded.model,
                    status: 'completed',
                    attempt: 1,
                    durationMs: now() - embeddingStartedAt,
                    inputTokens: embedded.tokens,
                    outputTokens: null,
                    estimatedCost: embedded.estimatedCost,
                    input: { kind: 'embedding', texts: [query] },
                    output: {
                      vectorCount: embedded.vectors.length,
                      dimensions: embedded.vectors[0]?.length ?? 0,
                      tokens: embedded.tokens,
                      estimatedCost: embedded.estimatedCost,
                    },
                    metadata: { dimensions: embedded.vectors[0]?.length ?? 0 },
                  });
                } catch (error) {
                  report.recordModelCall({
                    name: 'query-embedding',
                    provider: 'dashscope',
                    model: runtime.ragConfig.embeddingModel,
                    status: 'failed',
                    attempt: 1,
                    durationMs: now() - embeddingStartedAt,
                    inputTokens: null,
                    outputTokens: null,
                    input: { kind: 'embedding', texts: [query] },
                    output: { error },
                  });
                  throw error;
                }
                embeddingTokens += embedded.tokens;
                queryEmbeddings.set(query, embedded);
              }
              /** 执行一次带重排审计的检索；旧测试替身仍可走数组兼容路径。 */
              const retrieve = async (scope: CategorySearchFilter) => {
                const detailed = crossBase
                  ? this.options.knowledgeRepository.searchManyDetailed
                  : this.options.knowledgeRepository.searchDetailed;
                if (detailed) {
                  const result = crossBase
                    ? await this.options.knowledgeRepository.searchManyDetailed!(
                        searchBaseIds,
                        embedded!.vectors[0] ?? [],
                        runtime.ragConfig.embeddingModel,
                        scope,
                        { query, signal, rerank: runtime.rerank },
                      )
                    : await this.options.knowledgeRepository.searchDetailed!(
                        command.knowledgeBaseId,
                        embedded!.vectors[0] ?? [],
                        runtime.ragConfig.embeddingModel,
                        scope,
                        { query, signal, rerank: runtime.rerank },
                      );
                  rerankTokens += result.audit.rerankTokens;
                  if (result.audit.rerankStatus === 'fallback') rerankStatus = 'fallback';
                  else if (rerankStatus !== 'fallback') rerankStatus = result.audit.rerankStatus;
                  if (result.audit.rerankStatus !== 'disabled' && result.audit.candidateCount > 0) {
                    report.recordModelCall({
                      name: 'knowledge-rerank',
                      provider: 'dashscope',
                      model: result.audit.rerankerModel ?? 'qwen3.7-text-rerank',
                      status: result.audit.rerankStatus === 'fallback' ? 'failed' : 'completed',
                      attempt: 1,
                      durationMs: result.audit.rerankDurationMs,
                      inputTokens: result.audit.rerankTokens || null,
                      outputTokens: 0,
                      input: {
                        queryLength: query.length,
                        candidateCount: result.audit.candidateCount,
                        selectedCount: result.audit.selectedCount,
                      },
                      output: {
                        status: result.audit.rerankStatus,
                        finalChunkIds: result.audit.finalChunkIds,
                        promotedCount: result.audit.promotedCount,
                        reordered: result.audit.reordered,
                        scores: result.chunks.map((chunk) => ({
                          chunkId: chunk.id,
                          score: chunk.rerankScore,
                        })),
                        fallbackReason: result.audit.fallbackReason,
                      },
                      metadata: {
                        bindingRevisionId: result.audit.rerankBindingRevisionId,
                      },
                    });
                  }
                  return result;
                }
                const chunks = crossBase
                  ? await this.options.knowledgeRepository.searchMany(
                      searchBaseIds,
                      embedded!.vectors[0] ?? [],
                      runtime.ragConfig.embeddingModel,
                      scope,
                    )
                  : await this.options.knowledgeRepository.search(
                      command.knowledgeBaseId,
                      embedded!.vectors[0] ?? [],
                      runtime.ragConfig.embeddingModel,
                      scope,
                    );
                return {
                  chunks,
                  audit: {
                    rerankStatus: 'disabled' as const,
                    rerankerModel: null,
                    rerankBindingRevisionId: null,
                    candidateCount: chunks.length,
                    finalChunkIds: chunks.map((chunk) => chunk.id),
                    rerankTokens: 0,
                    rerankDurationMs: 0,
                    fallbackReason: null,
                  },
                };
              };
              let retrievalResult = await retrieve(filter);
              let chunks = retrievalResult.chunks;
              retrievalAudit.push({
                call: retrievalCall,
                query,
                categoryIds: filter.categoryIds ?? null,
                reason: filter.reason,
                knowledgeBaseIds: searchBaseIds,
                hitCount: chunks.length,
                ...retrievalResult.audit,
                durationMs: now() - retrievalStartedAt,
              });
              if (!chunks.length && retrievalCalls < MAX_SEARCH_CALLS) {
                const fallback = categoryPolicy.fallback('zero-hits');
                if (fallback) {
                  retrievalCalls += 1;
                  const fallbackStartedAt = now();
                  filter = fallback;
                  retrievalResult = await retrieve(fallback);
                  chunks = retrievalResult.chunks;
                  retrievalAudit.push({
                    call: retrievalCalls,
                    query,
                    categoryIds: null,
                    reason: fallback.reason,
                    knowledgeBaseIds: searchBaseIds,
                    hitCount: chunks.length,
                    ...retrievalResult.audit,
                    durationMs: now() - fallbackStartedAt,
                  });
                }
              }
              for (const chunk of chunks) retrieved.set(chunk.id, chunk);
              const output = {
                actualScope: {
                  categoryIds: filter.categoryIds ?? null,
                  reason: filter.reason,
                  includeTestSamples: filter.includeTestSamples,
                },
                chunks: chunks.map((chunk) => ({
                  chunkId: chunk.id,
                  documentTitle: chunk.documentTitle,
                  title: chunk.title,
                  headingPath: chunk.headingPath,
                  contentKind: chunk.contentKind,
                  partIndex: chunk.partIndex,
                  partCount: chunk.partCount,
                  locator: chunk.locator,
                  content: chunk.content,
                  rerankScore: chunk.rerankScore,
                })),
              };
              const summary = {
                categoryIds: filter.categoryIds ?? null,
                scopeReason: filter.reason,
                call: retrievalCall,
                queryLength: query.length,
                hitCount: chunks.length,
                chunkIds: chunks.map((chunk) => chunk.id),
              };
              report.recordToolCall({
                name: 'search_knowledge',
                status: 'completed',
                durationMs: now() - retrievalStartedAt,
                summary,
                input: { query },
                output,
              });
              report.recordStep({
                name: 'retrieve-knowledge',
                status: 'completed',
                durationMs: now() - retrievalStartedAt,
                metadata: summary,
              });
              return output;
            } catch (error) {
              report.recordToolCall({
                name: 'search_knowledge',
                status: 'failed',
                durationMs: now() - retrievalStartedAt,
                summary: { call: retrievalCall, queryLength: query.length },
                input: { query },
              });
              report.recordStep({
                name: 'retrieve-knowledge',
                status: 'failed',
                durationMs: now() - retrievalStartedAt,
                metadata: { call: retrievalCall },
              });
              throw error;
            }
          },
        });
        report.recordStep({
          name: 'agent-generate',
          status: 'completed',
          durationMs: now() - generationStartedAt,
          metadata: {
            retrievalLimited: generated.retrievalLimited ?? false,
            blockedRetrievalCalls: generated.blockedRetrievalCalls ?? 0,
          },
        });
      } catch (error) {
        report.recordStep({
          name: 'agent-generate',
          status: 'failed',
          durationMs: now() - generationStartedAt,
        });
        throw error;
      }
      retrievalLimited ||= generated.retrievalLimited ?? false;
      blockedRetrievalCalls += generated.blockedRetrievalCalls ?? 0;
      if (retrievalLimited) {
        report.recordStep({
          name: 'retrieval-limit',
          status: 'completed',
          metadata: {
            maxSearchCalls: MAX_SEARCH_CALLS,
            retrievalCalls,
            blockedRetrievalCalls,
          },
        });
      }

      let candidate = generated.candidate;
      let validIds = candidate.citedChunkIds.filter((id) => retrieved.has(id));
      let correctionUsage = { inputTokens: 0, outputTokens: 0 };

      // 只有越权 ID 才需要纠正；合法引用一律保留，否则正文中的 [n] 会失去对应来源。
      const needsCitationCorrection = validIds.length !== candidate.citedChunkIds.length;
      if (needsCitationCorrection) {
        const correctionStartedAt = now();
        report.recordStep({ name: 'citation-correction', status: 'started' });
        let corrected;
        try {
          corrected = await runtime.agent.correctCitations(
            candidate,
            [...retrieved.keys()],
            MAX_CITATIONS,
            signal,
            report,
          );
        } catch (error) {
          report.recordStep({
            name: 'citation-correction',
            status: 'failed',
            durationMs: now() - correctionStartedAt,
          });
          throw error;
        }
        candidate = corrected.candidate;
        correctionUsage = corrected.usage;
        validIds = candidate.citedChunkIds.filter((id) => retrieved.has(id));
        report.recordStep({
          name: 'citation-correction',
          status: 'completed',
          durationMs: now() - correctionStartedAt,
          metadata: {
            allowedCount: retrieved.size,
            validCount: validIds.length,
            citationCount: candidate.citedChunkIds.length,
            safeLimit: MAX_CITATIONS,
            limitStillExceeded: candidate.citedChunkIds.length > MAX_CITATIONS,
          },
        });
      }

      // 模型声明无依据、未引用证据或仍引用越权 ID 时，统一降级为稳定拒答。
      const fellBack =
        !candidate.grounded ||
        validIds.length === 0 ||
        validIds.length !== candidate.citedChunkIds.length;

      /**
       * 检索已经拿到合法段落、但候选回答仍未引用任何证据时，先补齐一次依据再决定是否拒答。
       *
       * 否则会把“模型漏引用”误报成“知识库没有依据”（跨库检索更容易触发）。
       */
      const needsGroundingRescue = fellBack && retrieved.size > 0 && validIds.length === 0;
      if (needsGroundingRescue) {
        const rescueStartedAt = now();
        report.recordStep({ name: 'grounding-rescue', status: 'started' });
        const passages = [...retrieved.values()].slice(0, MAX_GROUNDING_PASSAGES).map((chunk) => ({
          chunkId: chunk.id,
          documentTitle: chunk.documentTitle,
          title: chunk.title,
          headingPath: chunk.headingPath,
          contentKind: chunk.contentKind,
          partIndex: chunk.partIndex,
          partCount: chunk.partCount,
          content: chunk.content,
        }));
        const rescued = await runtime.agent.groundAnswer({
          question: request.question,
          passages,
          maxCitations: MAX_CITATIONS,
          signal,
          diagnostics: report,
        });
        const rescuedIds = rescued.citedChunkIds.filter((id) => retrieved.has(id));
        const rescuedAccepted =
          rescued.grounded &&
          rescuedIds.length > 0 &&
          rescuedIds.length === rescued.citedChunkIds.length;
        if (rescuedAccepted) {
          candidate = rescued;
          validIds = rescuedIds;
        }
        report.recordStep({
          name: 'grounding-rescue',
          status: 'completed',
          durationMs: now() - rescueStartedAt,
          metadata: {
            passageCount: passages.length,
            rescued: rescuedAccepted,
            citedCount: rescuedIds.length,
          },
        });
      }

      const stillFellBack =
        !candidate.grounded ||
        validIds.length === 0 ||
        validIds.length !== candidate.citedChunkIds.length;
      if (stillFellBack) {
        candidate = {
          answer: INSUFFICIENT_EVIDENCE,
          grounded: false,
          citedChunkIds: [],
        };
        validIds = [];
      }
      if (retrievalLimited) {
        candidate = {
          ...candidate,
          answer: appendRetrievalLimitNotice(candidate.answer),
        };
      }
      // 模型标记只影响编号展示，因此以答案正文为准重建连续编号，保证每个 [n] 都有对应来源。
      const aligned = resolveCitationMarkers(candidate.answer, validIds);
      candidate = { ...candidate, answer: aligned.answer };
      validIds = aligned.citationIds;
      report.recordStep({
        name: 'citation-validation',
        status: 'completed',
        metadata: {
          retrievedCount: retrieved.size,
          citedCount: validIds.length,
          grounded: candidate.grounded,
          fellBack: stillFellBack,
          rescued: needsGroundingRescue && !stillFellBack,
          droppedMarkerCount: aligned.droppedMarkerCount,
        },
      });

      const usage = {
        inputTokens: generated.usage.inputTokens + correctionUsage.inputTokens,
        outputTokens: generated.usage.outputTokens + correctionUsage.outputTokens,
      };
      const rerankDisclosure = readRerankDisclosure(retrievalAudit);
      const response = RagQueryResponseSchema.parse({
        conversationId: conversation.id,
        answer: candidate.answer,
        grounded: candidate.grounded,
        citations: validIds.map((id, index) => {
          const chunk = retrieved.get(id);
          if (!chunk) throw new Error('Validated citation disappeared.');
          return {
            number: index + 1,
            knowledgeBaseId: chunk.knowledgeBaseId,
            revisionId: chunk.revisionId ?? null,
            quoteSnapshot: chunk.content,
            sourceStatus: chunk.revisionId ? 'active' : 'unavailable',
            documentId: chunk.documentId,
            documentTitle: chunk.documentTitle,
            chunkId: chunk.id,
            locator: chunk.locator,
            excerpt: chunk.content.slice(0, 320),
          };
        }),
        usage: { embeddingTokens, rerankTokens, ...usage },
        retrieval: {
          rerankStatus,
          rerankerModel: runtime.rerank.model,
        },
        // 重排披露与实时检索审计同源，缺口（旧数据、未启用）时不渲染。
        ...(rerankDisclosure ? { rerank: rerankDisclosure } : {}),
      });

      const auditCompleteStartedAt = now();
      report.recordStep({ name: 'audit-complete', status: 'started' });
      try {
        await this.options.conversationRepository.completeRun(runId, {
          retrievalAudit,
          answer: response.answer,
          grounded: response.grounded,
          citedChunkIds: validIds,
          citations: response.citations,
          embeddingTokens,
          rerankTokens,
          rerankStatus,
          ...usage,
          durationMs: now() - startedAt,
        });
      } catch (error) {
        report.recordStep({
          name: 'audit-complete',
          status: 'failed',
          durationMs: now() - auditCompleteStartedAt,
        });
        throw error;
      }
      report.recordStep({
        name: 'audit-complete',
        status: 'completed',
        durationMs: now() - auditCompleteStartedAt,
      });
      report.recordOutput(response);
      await report.finish({
        status: 'completed',
        metadata: {
          grounded: response.grounded,
          citationCount: response.citations.length,
          retrievalCalls,
          retrievalLimited,
          blockedRetrievalCalls,
          maxSearchCalls: MAX_SEARCH_CALLS,
          embeddingTokens,
          rerankTokens,
          rerankStatus,
          ...usage,
        },
      });
      return response;
    } catch (error) {
      // 审计失败是次生故障，不能覆盖触发失败的原始异常。
      const auditFailureStartedAt = now();
      report.recordStep({ name: 'audit-fail', status: 'started' });
      let failureAuditCompleted = true;
      await this.options.conversationRepository.failRun(runId, now() - startedAt).then(
        () =>
          report.recordStep({
            name: 'audit-fail',
            status: 'completed',
            durationMs: now() - auditFailureStartedAt,
          }),
        () => {
          failureAuditCompleted = false;
          report.recordStep({
            name: 'audit-fail',
            status: 'failed',
            durationMs: now() - auditFailureStartedAt,
          });
        },
      );
      await report.finish({
        status: 'failed',
        error,
        metadata: {
          retrievalCalls,
          retrievalLimited,
          blockedRetrievalCalls,
          maxSearchCalls: MAX_SEARCH_CALLS,
          embeddingTokens,
          rerankTokens,
          rerankStatus,
          failureAuditCompleted,
        },
      });
      if (isTimeout(error)) {
        throw new KnowledgeAnswerError('MODEL_TIMEOUT', '问答模型响应超时，请稍后重试。');
      }
      if (error instanceof KnowledgeAnswerError || error instanceof RagRepositoryError) throw error;
      console.error('Knowledge answer failed', error, {
        conversationId: conversation.id,
        knowledgeBaseId: command.knowledgeBaseId,
      });
      throw new KnowledgeAnswerError('MODEL_UNAVAILABLE', '问答模型暂时不可用，请稍后重试。');
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
    const running = this.cleanupExpiredConversations().catch((error: unknown) => {
      console.error('Failed to clean expired RAG conversations', error);
    });
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
        await this.options.conversationRepository.deleteExpiredConversation(conversation.id);
      } catch (error) {
        console.error('Failed to clean expired RAG conversation', error, {
          conversationId: conversation.id,
        });
      }
    }
  }
}
