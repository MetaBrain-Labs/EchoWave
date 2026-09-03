/**
 * 分组业务分析工作流入口。
 *
 * 管理稳定 thread、checkpoint 恢复、Graph 调用和终态清理；节点和拓扑分别独立维护。
 *
 * Responsibilities:
 * - 使用版本化 thread ID 恢复失败节点。
 * - 注入运行期报告器与进度通知。
 * - 返回发布结果、检索证据和恢复标记。
 *
 * Notes:
 * - checkpoint 只服务非终态恢复，终态清理由 Worker 负责。
 */
import type { BaseCheckpointSaver } from '@langchain/langgraph';

import type { AiExecutionRecorder } from '../../../ai-observability/executionReporter.ts';
import type { DashScopeEmbeddings } from '../../../knowledge/embeddings/dashScopeEmbeddings.ts';
import type { KnowledgeSearchPort } from '../../../knowledge/retrieval/port.ts';
import type { RetrievalChunk } from '../../../knowledge/retrieval/types.ts';
import type {
  BusinessAnalysisPublication,
  BusinessAnalysisRepository,
  ClaimedBusinessAnalysisJob,
} from './repository.ts';
import type { SalesAnalysisAgent } from './salesAnalysisAgent.ts';
import { createBusinessAnalysisGraph } from './graph/graph.ts';
import type { BusinessAnalysisNodeOptions } from './graph/nodes.ts';

export { buildBusinessRetrievalQueries } from './graph/nodes.ts';
export { buildBusinessAnalysisWindows } from './windowing.ts';

type BusinessAnalysisWorkflowOptions = {
  repository: BusinessAnalysisRepository;
  knowledgeRepository: KnowledgeSearchPort;
  embeddings: Pick<DashScopeEmbeddings, 'embedQuery'>;
  embeddingModel: string;
  agent: SalesAnalysisAgent;
  checkpointer: BaseCheckpointSaver;
  saveWindowResult?: BusinessAnalysisNodeOptions['saveWindowResult'];
};

export type BusinessAnalysisWorkflowResult = {
  publication: BusinessAnalysisPublication;
  retrievedChunks: RetrievalChunk[];
  resumed: boolean;
};

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
    this.graph = createBusinessAnalysisGraph(options);
  }

  /** 首次使用任务快照启动；已有 checkpoint 时以 null 从失败节点恢复。 */
  async run(
    job: ClaimedBusinessAnalysisJob,
    report: AiExecutionRecorder,
    notifyProgress: () => void,
  ): Promise<BusinessAnalysisWorkflowResult> {
    const config = { configurable: { thread_id: businessAnalysisThreadId(job) } };
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
}
