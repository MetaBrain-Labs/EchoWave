/**
 * 业务分析 LangGraph 状态。
 *
 * 定义 checkpoint 状态、并行检索归并规则和运行期非持久依赖。
 *
 * Responsibilities:
 * - 声明任务、查询、检索块、草稿和发布结果。
 * - 去重合并并行检索结果。
 *
 * Notes:
 * - 报告器和进度通知只通过 runtime context 注入，不写入 checkpoint。
 */
import { Annotation } from '@langchain/langgraph';

import type { AiExecutionRecorder } from '../../../../ai-observability/executionReporter.ts';
import type { RetrievalChunk } from '../../../../knowledge/retrieval/types.ts';
import type { BusinessAnalysisPublication, ClaimedBusinessAnalysisJob } from '../repository.ts';

function mergeRetrievedChunks(
  current: readonly RetrievalChunk[],
  update: readonly RetrievalChunk[],
): RetrievalChunk[] {
  const merged = new Map(current.map((chunk) => [chunk.id, chunk] as const));
  for (const chunk of update) merged.set(chunk.id, chunk);
  return [...merged.values()];
}

/** 可持久化的业务分析 Graph 状态。 */
export const BusinessAnalysisState = Annotation.Root({
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

/** 不进入 checkpoint 的业务分析运行期上下文。 */
export const BusinessAnalysisRuntimeContext = Annotation.Root({
  report: Annotation<AiExecutionRecorder>(),
  notifyProgress: Annotation<() => void>(),
});

export type BusinessAnalysisRuntime = typeof BusinessAnalysisRuntimeContext.State;
