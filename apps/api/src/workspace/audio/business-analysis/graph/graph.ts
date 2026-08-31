/**
 * 业务分析 LangGraph 构造器。
 *
 * 只声明稳定节点、条件扇出和边，不承载节点业务实现。
 *
 * Responsibilities:
 * - 组装准备、规划、并行检索、Agent、校验和发布流程。
 * - 使用 PostgreSQL checkpointer 编译持久化 Graph。
 *
 * Notes:
 * - 节点名称和图名称属于恢复兼容边界，禁止无迁移改名。
 */
import { END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';

import { createBusinessAnalysisNodes, type BusinessAnalysisNodeOptions } from './nodes.ts';
import { BusinessAnalysisRuntimeContext, BusinessAnalysisState } from './state.ts';

/** 创建可持久恢复的销售复盘 Graph。 */
export function createBusinessAnalysisGraph(
  options: BusinessAnalysisNodeOptions & { checkpointer: BaseCheckpointSaver },
) {
  const nodes = createBusinessAnalysisNodes(options);
  return new StateGraph(BusinessAnalysisState, BusinessAnalysisRuntimeContext)
    .addNode('prepare', nodes.prepareNode)
    .addNode('plan_retrieval', nodes.planRetrievalNode)
    .addNode('retrieve_query', nodes.retrieveQueryNode)
    .addNode('deep_agent', nodes.deepAgentNode)
    .addNode('validate', nodes.validateNode)
    .addNode('publish', nodes.publishNode)
    .addEdge(START, 'prepare')
    .addEdge('prepare', 'plan_retrieval')
    .addConditionalEdges('plan_retrieval', nodes.routeRetrieval)
    .addEdge('retrieve_query', 'deep_agent')
    .addEdge('deep_agent', 'validate')
    .addEdge('validate', 'publish')
    .addEdge('publish', END)
    .compile({ checkpointer: options.checkpointer, name: 'echowave-business-analysis' });
}
