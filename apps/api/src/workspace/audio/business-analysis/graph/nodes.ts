/**
 * 业务分析 LangGraph 节点。
 *
 * 实现准备、检索规划、检索、Agent 分析、校验和发布节点，供 graph 构造器按名称引用。
 *
 * Responsibilities:
 * - 维护模型与工具审计、单调进度和证据边界。
 * - 通过窄知识检索端口访问关联知识库。
 *
 * Notes:
 * - 节点名称、错误语义和发布事务保持现有行为。
 */
import { Send } from '@langchain/langgraph';

import {
  beginAiModelCall,
  beginAiToolCall,
  type AiExecutionRecorder,
} from '../../../../ai-observability/executionReporter.ts';
import type { DashScopeEmbeddings } from '../../../../knowledge/embeddings/dashScopeEmbeddings.ts';
import type { KnowledgeSearchPort } from '../../../../knowledge/retrieval/port.ts';
import type { RetrievalChunk } from '../../../../knowledge/retrieval/types.ts';
import type {
  BusinessAnalysisPublication,
  BusinessAnalysisRepository,
  ClaimedBusinessAnalysisJob,
} from '../repository.ts';
import { BusinessAnalysisProviderError, type SalesAnalysisAgent } from '../salesAnalysisAgent.ts';
import type { BusinessAnalysisRuntime } from './state.ts';

const coreSummaryLabels = {
  overall: '总体总结',
  strengths: '话术优点',
  improvements: '待改进点',
  risks: '风险提示',
  actions: '行动建议',
} as const;

export type BusinessAnalysisNodeOptions = {
  repository: BusinessAnalysisRepository;
  knowledgeRepository: KnowledgeSearchPort;
  embeddings: Pick<DashScopeEmbeddings, 'embedQuery'>;
  embeddingModel: string;
  agent: SalesAnalysisAgent;
};

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

function runtime(context: BusinessAnalysisRuntime | undefined): BusinessAnalysisRuntime {
  if (!context) throw new Error('Business analysis workflow runtime context is missing.');
  return context;
}

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

/** 创建业务分析 Graph 使用的命名节点和条件路由函数。 */
export function createBusinessAnalysisNodes(options: BusinessAnalysisNodeOptions) {
  async function progress(jobId: string, value: number, context: BusinessAnalysisRuntime) {
    await options.repository.updateProgress(jobId, value);
    context.notifyProgress();
  }

  async function searchKnowledge(
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
      model: options.embeddingModel,
      attempt,
      reasoningMode: 'unsupported',
    });
    let embedding: number[];
    try {
      embedding = await options.embeddings.embedQuery(query);
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
      summary: { audit: { query, knowledgeBases: job.knowledgeBases, hitCount: 0, hits: [] } },
    });
    try {
      const chunks = await options.knowledgeRepository.searchMany(
        job.knowledgeBaseIds,
        embedding,
        options.embeddingModel,
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

  function validateAndLocalize(
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
    if (!job.segments.some((segment) => segment.role))
      limitations.push('本次分析未使用角色识别结果。');
    if (!job.segments.some((segment) => segment.emotion))
      limitations.push('本次分析未使用情绪识别结果。');
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

  async function prepareNode({ job }: any) {
    if (job.segments.length === 0) {
      throw new BusinessAnalysisProviderError(
        'INVALID_MODEL_OUTPUT',
        '确认转写中没有可分析的正文。',
        false,
      );
    }
    return {};
  }

  async function planRetrievalNode({ job }: any, graphRuntime: any) {
    const context = runtime(graphRuntime.context);
    context.report.recordStep({ name: 'retrieval-planning', status: 'started' });
    try {
      const plannedQueries = await options.agent.planRetrievalQueries(job, context.report);
      const queries =
        plannedQueries.length > 0
          ? plannedQueries
          : buildBusinessRetrievalQueries(job.settings.contentFocus, job.segments);
      context.report.recordStep({
        name: 'retrieval-planning',
        status: 'completed',
        metadata: { queryCount: queries.length, usedFallback: plannedQueries.length === 0 },
      });
      await progress(job.id, 15, context);
      return { queries };
    } catch (error) {
      context.report.recordStep({ name: 'retrieval-planning', status: 'failed' });
      throw error;
    }
  }

  async function retrieveQueryNode(
    { job, retrievalAttempt, retrievalQuery }: any,
    graphRuntime: any,
  ) {
    const context = runtime(graphRuntime.context);
    return {
      retrievedChunks: await searchKnowledge(job, retrievalQuery, retrievalAttempt, context.report),
    };
  }

  async function deepAgentNode({ job, queries, retrievedChunks }: any, graphRuntime: any) {
    const context = runtime(graphRuntime.context);
    context.report.recordStep({
      name: 'analysis-generation',
      status: 'started',
      metadata: { preRetrievedChunkCount: retrievedChunks.length },
    });
    const additionalChunks: RetrievalChunk[] = [];
    let supplementalAttempt = queries.length;
    try {
      const draft = await options.agent.analyze({
        job,
        preRetrieved: retrievedChunks,
        searchKnowledge: async (query) => {
          supplementalAttempt += 1;
          const chunks = await searchKnowledge(job, query, supplementalAttempt, context.report);
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
  }

  async function validateNode({ draft, job, retrievedChunks }: any, graphRuntime: any) {
    const context = runtime(graphRuntime.context);
    context.report.recordStep({ name: 'business-analysis-validation', status: 'started' });
    try {
      const publication = validateAndLocalize(job, draft, retrievedChunks);
      await progress(job.id, 92, context);
      context.report.recordStep({ name: 'business-analysis-validation', status: 'completed' });
      return { publication };
    } catch (error) {
      context.report.recordStep({ name: 'business-analysis-validation', status: 'failed' });
      throw error;
    }
  }

  async function publishNode({ job, publication, retrievedChunks }: any, graphRuntime: any) {
    const context = runtime(graphRuntime.context);
    context.report.recordStep({ name: 'publish', status: 'started' });
    try {
      await options.repository.publish(
        job,
        publication,
        new Map(retrievedChunks.map((chunk: RetrievalChunk) => [chunk.id, chunk] as const)),
      );
      context.notifyProgress();
      context.report.recordStep({ name: 'publish', status: 'completed' });
      return {};
    } catch (error) {
      context.report.recordStep({ name: 'publish', status: 'failed' });
      throw error;
    }
  }

  function routeRetrieval({ job, queries }: any) {
    if (job.knowledgeBaseIds.length === 0 || queries.length === 0) return 'deep_agent';
    return queries.map(
      (query: string, index: number) =>
        new Send('retrieve_query', { job, retrievalAttempt: index + 1, retrievalQuery: query }),
    );
  }

  return {
    prepareNode,
    planRetrievalNode,
    retrieveQueryNode,
    deepAgentNode,
    validateNode,
    publishNode,
    routeRetrieval,
  };
}
