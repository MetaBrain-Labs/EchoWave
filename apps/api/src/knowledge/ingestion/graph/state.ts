/**
 * 知识入库 LangGraph 状态。
 *
 * 定义节点间传递的任务、文件、解析结果、向量和执行报告状态。
 *
 * Responsibilities:
 * - 声明可序列化和运行期入库状态字段。
 *
 * Notes:
 * - 当前入库 Graph 不使用持久化 checkpointer。
 */
import { Annotation } from '@langchain/langgraph';

import type { AiExecutionRecorder } from '../../../ai-observability/executionReporter.ts';
import type { EmbeddingBatchResult } from '../../embeddings/dashScopeEmbeddings.ts';
import type { ClaimedIngestionJob } from '../../persistence/ingestionRepository.ts';
import type { ParsedDocument } from '../documentParser.ts';

/** 知识入库节点共享状态。 */
export const IngestionState = Annotation.Root({
  job: Annotation<ClaimedIngestionJob>(),
  source: Annotation<Buffer>(),
  parsed: Annotation<ParsedDocument>(),
  embedding: Annotation<EmbeddingBatchResult>(),
  report: Annotation<AiExecutionRecorder>(),
});
