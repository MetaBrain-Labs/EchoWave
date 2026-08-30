/**
 * 分组业务分析 LangGraph 工作流。
 *
 * 将检索规划、并行知识检索、DeepAgent 生成、结果校验和原子发布拆成可持久恢复节点；
 * DeepAgent 保持原子执行边界，运行期服务与审计器不进入 checkpoint。
 *
 * Responsibilities:
 * - 使用稳定 thread ID 与 PostgreSQL checkpointer 恢复失败节点。
 * - 并行执行预检索并合并去重知识块。
 * - 在发布前验证模型证据边界并维持单调进度。
 *
 * Notes:
 * - checkpoint 只服务非终态恢复，终态清理由 Worker 负责。
 * - DeepAgent 内部模型与工具回合不单独 checkpoint。
 */
import {
  Annotation,
  END,
  Send,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';

import {
  beginAiModelCall,
  beginAiToolCall,
  type AiExecutionRecorder,
} from '../../ai-observability/executionReporter.ts';
import type { DashScopeEmbeddings } from '../../knowledge/embeddings/dashScopeEmbeddings.ts';
import type {
  KnowledgeRepository,
  RetrievalChunk,
} from '../../knowledge/persistence/knowledgeRepository.ts';
import type {
  BusinessAnalysisPublication,
  BusinessAnalysisRepository,
  ClaimedBusinessAnalysisJob,
} from '../persistence/businessAnalysisRepository.ts';
import { BusinessAnalysisProviderError, type SalesAnalysisAgent } from './salesAnalysisAgent.ts';

const coreSummaryLabels = {
  overall: '总体总结',
  strengths: '话术优点',
  improvements: '待改进点',
  risks: '风险提示',
  actions: '行动建议',
} as const;

const BusinessAnalysisState = Annotation.Root({
  job: Annotation<ClaimedBusinessAnalysisJob>(),
  queries: Annotation<string[]>({ default: () => [], reducer: (_current, update) => update }),
  retrievalQuery: Annotation<string>(),
  retrievalAttempt: Annotation<number>(),
  retrievedChunks: Annotation<RetrievalChunk[]>({
    default: () => [],
    reducer: (current, update) => mergeRetrievedChunks(current, update),
  }),
  draft: Annotation<BusinessAnalysisPublication>(),
  publication: Annotation<BusinessAnalysisPublication>(),
});

const BusinessAnalysisRuntimeContext = Annotation.Root({
  report: Annotation<AiExecutionRecorder>(),
  notifyProgress: Annotation<() => void>(),
});

type WorkflowRuntime = typeof BusinessAnalysisRuntimeContext.State;

type BusinessAnalysisWorkflowOptions = {
  repository: BusinessAnalysisRepository;
  knowledgeRepository: KnowledgeRepository;
  embeddings: Pick<DashScopeEmbeddings, 'embedQuery'>;
  embeddingModel: string;
  agent: SalesAnalysisAgent;
  checkpointer: BaseCheckpointSaver;
};

export type BusinessAnalysisWorkflowResult = {
  publication: BusinessAnalysisPublication;
  retrievedChunks: RetrievalChunk[];
  resumed: boolean;
};

/** 将模型侧固定英文代码转换为产品侧中文章节标题。 */
function localizeCoreSummaryTitle(title: string): string {
  if (!(title in coreSummaryLabels)) {
    throw new BusinessAnalysisProviderError(
      'INVALID_MODEL_OUTPUT',
      '销售复盘返回了未知的总结章节。',
      true,
    );
  }
  return coreSummaryLabels[title as keyof typeof coreSummaryLabels];
}

/** 将长转写分成最多三个有界主动检索查询。 */
export function buildBusinessRetrievalQueries(
  contentFocus: string,
  segments: readonly { text: string }[],
): string[] {
  const transcript = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join('\n');
  if (!transcript) return [];
  const size = Math.max(1, Math.ceil(transcript.length / 3));
  return [0, size, size * 2]
    .map((start) => transcript.slice(start, start + Math.min(size, 2_500)).trim())
    .filter(Boolean)
    .map((part) => `${contentFocus.slice(0, 600)}\n对话片段：${part}`);
}

function mergeRetrievedChunks(
  current: readonly RetrievalChunk[],
  update: readonly RetrievalChunk[],
): RetrievalChunk[] {
  const merged = new Map(current.map((chunk) => [chunk.id, chunk] as const));
  for (const chunk of update) merged.set(chunk.id, chunk);
  return [...merged.values()];
}

/** 为业务分析任务生成稳定且有版本边界的 LangGraph thread ID。 */
export function businessAnalysisThreadId(
  job: Pick<ClaimedBusinessAnalysisJob, 'id' | 'workflowVersion'>,
) {
  return `echowave:business-analysis:${job.workflowVersion}:${job.id}`;
}

/** 执行并恢复单个版本化业务分析任务。 */
export class BusinessAnalysisWorkflow {
  private readonly graph;

  constructor(private readonly options: BusinessAnalysisWorkflowOptions) {
    this.graph = new StateGraph(BusinessAnalysisState, BusinessAnalysisRuntimeContext)
      .addNode('prepare', async ({ job }) => {
        if (job.segments.length === 0) {
          throw new BusinessAnalysisProviderError(
            'INVALID_MODEL_OUTPUT',
            '确认转写中没有可分析的正文。',
            false,
          );
        }
        return {};
      })
      .addNode('plan_retrieval', async ({ job }, runtime) => {
        const context = this.runtime(runtime.context);
        context.report.recordStep({ name: 'retrieval-planning', status: 'started' });
        try {
          const plannedQueries = await this.options.agent.planRetrievalQueries(job, context.report);
          const queries =
            plannedQueries.length > 0
              ? plannedQueries
              : buildBusinessRetrievalQueries(job.settings.contentFocus, job.segments);
          context.report.recordStep({
            name: 'retrieval-planning',
            status: 'completed',
            metadata: { queryCount: queries.length, usedFallback: plannedQueries.length === 0 },
          });
          await this.progress(job.id, 15, context);
          return { queries };
        } catch (error) {
          context.report.recordStep({ name: 'retrieval-planning', status: 'failed' });
          throw error;
        }
      })
      .addNode('retrieve_query', async ({ job, retrievalAttempt, retrievalQuery }, runtime) => {
        const context = this.runtime(runtime.context);
        const retrievedChunks = await this.searchKnowledge(
          job,
          retrievalQuery,
          retrievalAttempt,
          context.report,
        );
        return { retrievedChunks };
      })
      .addNode('deep_agent', async ({ job, queries, retrievedChunks }, runtime) => {
        const context = this.runtime(runtime.context);
        context.report.recordStep({
          name: 'analysis-generation',
          status: 'started',
          metadata: { preRetrievedChunkCount: retrievedChunks.length },
        });
        const additionalChunks: RetrievalChunk[] = [];
        let supplementalAttempt = queries.length;
        try {
          const draft = await this.options.agent.analyze({
            job,
            preRetrieved: retrievedChunks,
            searchKnowledge: async (query) => {
              supplementalAttempt += 1;
              const chunks = await this.searchKnowledge(
                job,
                query,
                supplementalAttempt,
                context.report,
              );
              additionalChunks.push(...chunks);
              return chunks;
            },
            recorder: context.report,
          });
          context.report.recordStep({ name: 'analysis-generation', status: 'completed' });
          return { draft, retrievedChunks: additionalChunks };
        } catch (error) {
          context.report.recordStep({ name: 'analysis-generation', status: 'failed' });
          throw error;
        }
      })
      .addNode('validate', async ({ draft, job, retrievedChunks }, runtime) => {
        const context = this.runtime(runtime.context);
        context.report.recordStep({ name: 'business-analysis-validation', status: 'started' });
        try {
          const publication = this.validateAndLocalize(job, draft, retrievedChunks);
          await this.progress(job.id, 92, context);
          context.report.recordStep({
            name: 'business-analysis-validation',
            status: 'completed',
          });
          return { publication };
        } catch (error) {
          context.report.recordStep({ name: 'business-analysis-validation', status: 'failed' });
          throw error;
        }
      })
      .addNode('publish', async ({ job, publication, retrievedChunks }, runtime) => {
        const context = this.runtime(runtime.context);
        context.report.recordStep({ name: 'publish', status: 'started' });
        try {
          await this.options.repository.publish(
            job,
            publication,
            new Map(retrievedChunks.map((chunk) => [chunk.id, chunk] as const)),
          );
          context.notifyProgress();
          context.report.recordStep({ name: 'publish', status: 'completed' });
          return {};
        } catch (error) {
          context.report.recordStep({ name: 'publish', status: 'failed' });
          throw error;
        }
      })
      .addEdge(START, 'prepare')
      .addEdge('prepare', 'plan_retrieval')
      .addConditionalEdges('plan_retrieval', ({ job, queries }) => {
        if (job.knowledgeBaseIds.length === 0 || queries.length === 0) return 'deep_agent';
        return queries.map(
          (query, index) =>
            new Send('retrieve_query', {
              job,
              retrievalAttempt: index + 1,
              retrievalQuery: query,
            }),
        );
      })
      .addEdge('retrieve_query', 'deep_agent')
      .addEdge('deep_agent', 'validate')
      .addEdge('validate', 'publish')
      .addEdge('publish', END)
      .compile({ checkpointer: options.checkpointer, name: 'echowave-business-analysis' });
  }

  /** 首次使用任务快照启动；已有 checkpoint 时以 null 从失败节点恢复。 */
  async run(
    job: ClaimedBusinessAnalysisJob,
    report: AiExecutionRecorder,
    notifyProgress: () => void,
  ): Promise<BusinessAnalysisWorkflowResult> {
    const config = {
      configurable: { thread_id: businessAnalysisThreadId(job) },
    };
    const resumed = Boolean(await this.options.checkpointer.getTuple(config));
    report.recordStep({
      name: 'workflow-resume',
      status: 'completed',
      metadata: {
        resumedFromCheckpoint: resumed,
        workflowVersion: job.workflowVersion,
        recoveryAttempt: job.recoveryAttempts,
      },
    });
    const result = await this.graph.invoke(resumed ? null : { job }, {
      ...config,
      context: { report, notifyProgress },
      durability: 'sync',
    });
    return {
      publication: result.publication,
      retrievedChunks: result.retrievedChunks,
      resumed,
    };
  }

  /** 删除终态任务的 thread，避免 checkpoint 长期复制转写与知识正文。 */
  deleteCheckpoint(job: Pick<ClaimedBusinessAnalysisJob, 'id' | 'workflowVersion'>): Promise<void> {
    return this.options.checkpointer.deleteThread(businessAnalysisThreadId(job));
  }

  private runtime(context: WorkflowRuntime | undefined): WorkflowRuntime {
    if (!context) throw new Error('Business analysis workflow runtime context is missing.');
    return context;
  }

  private async progress(jobId: string, value: number, context: WorkflowRuntime): Promise<void> {
    await this.options.repository.updateProgress(jobId, value);
    context.notifyProgress();
  }

  private async searchKnowledge(
    job: ClaimedBusinessAnalysisJob,
    query: string,
    attempt: number,
    report: AiExecutionRecorder,
  ): Promise<RetrievalChunk[]> {
    if (job.knowledgeBaseIds.length === 0) return [];
    const embeddingStartedAt = Date.now();
    const embeddingCall = beginAiModelCall(report, {
      name: 'business-analysis-query-embedding',
      displayName: '将知识检索问题转换为语义向量',
      provider: 'dashscope',
      model: this.options.embeddingModel,
      attempt,
      reasoningMode: 'unsupported',
    });
    let embedding: number[];
    try {
      embedding = await this.options.embeddings.embedQuery(query);
      embeddingCall.finish({
        status: 'completed',
        durationMs: Date.now() - embeddingStartedAt,
        inputTokens: null,
        outputTokens: null,
        input: { kind: 'embedding', texts: [query] },
        output: { vectorCount: 1, dimensions: embedding.length },
      });
    } catch (error) {
      embeddingCall.finish({
        status: 'failed',
        durationMs: Date.now() - embeddingStartedAt,
        inputTokens: null,
        outputTokens: null,
        input: { kind: 'embedding', texts: [query] },
        output: { error },
      });
      throw error;
    }

    const searchStartedAt = Date.now();
    const searchCall = beginAiToolCall(report, {
      name: 'search_knowledge',
      displayName: '检索分组关联知识库',
      summary: {
        audit: { query, knowledgeBases: job.knowledgeBases, hitCount: 0, hits: [] },
      },
    });
    try {
      const chunks = await this.options.knowledgeRepository.searchMany(
        job.knowledgeBaseIds,
        embedding,
        this.options.embeddingModel,
      );
      searchCall.finish({
        status: 'completed',
        durationMs: Date.now() - searchStartedAt,
        summary: {
          attempt,
          hitCount: chunks.length,
          audit: {
            query,
            knowledgeBases: job.knowledgeBases,
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
        input: { query, knowledgeBaseIds: job.knowledgeBaseIds },
        output: chunks,
      });
      return chunks;
    } catch (error) {
      searchCall.finish({
        status: 'failed',
        durationMs: Date.now() - searchStartedAt,
        summary: {
          attempt,
          audit: { query, knowledgeBases: job.knowledgeBases, hitCount: 0, hits: [] },
        },
        input: { query, knowledgeBaseIds: job.knowledgeBaseIds },
        output: { error },
      });
      throw error;
    }
  }

  private validateAndLocalize(
    job: ClaimedBusinessAnalysisJob,
    draft: BusinessAnalysisPublication,
    retrievedChunks: readonly RetrievalChunk[],
  ): BusinessAnalysisPublication {
    const segmentIds = new Set(job.segments.map((segment) => segment.id));
    const retrievedIds = new Set(retrievedChunks.map((chunk) => chunk.id));
    const customTags = new Set(job.settings.customTags);
    for (const tag of draft.tags) {
      if (tag.evidenceSegmentIds.some((id) => !segmentIds.has(id))) {
        throw new BusinessAnalysisProviderError(
          'INVALID_MODEL_OUTPUT',
          '销售复盘引用了不存在的转写片段。',
          true,
        );
      }
      if (tag.citedChunkIds.some((id) => !retrievedIds.has(id))) {
        throw new BusinessAnalysisProviderError(
          'INVALID_MODEL_OUTPUT',
          '销售复盘引用了未检索或未授权的知识块。',
          true,
        );
      }
      if (
        (tag.category === 'custom' && (!tag.customLabel || !customTags.has(tag.customLabel))) ||
        (tag.category !== 'custom' && tag.customLabel !== null)
      ) {
        throw new BusinessAnalysisProviderError(
          'INVALID_MODEL_OUTPUT',
          '销售复盘返回了未配置的自定义标签。',
          true,
        );
      }
    }

    const limitations = [...draft.limitations];
    if (!job.segments.some((segment) => segment.role)) {
      limitations.push('本次分析未使用角色识别结果。');
    }
    if (!job.segments.some((segment) => segment.emotion)) {
      limitations.push('本次分析未使用情绪识别结果。');
    }
    if (job.knowledgeBaseIds.length === 0) limitations.push('本次分析未使用知识库。');
    return {
      ...draft,
      limitations: [...new Set(limitations)],
      summarySections: draft.summarySections.map((section) => ({
        ...section,
        title: localizeCoreSummaryTitle(section.title),
      })),
    };
  }
}
