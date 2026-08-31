/**
 * 知识入库 LangGraph 构造器。
 *
 * 只声明节点注册和有向边，节点业务逻辑由 nodes 模块提供。
 *
 * Responsibilities:
 * - 以稳定节点名称组装入库流程。
 * - 编译供 IngestionWorker 调用的 graph。
 *
 * Notes:
 * - 节点顺序属于现有入库行为契约。
 */
import { END, START, StateGraph } from '@langchain/langgraph';

import { createIngestionNodes, type IngestionNodeOptions } from './nodes.ts';
import { IngestionState } from './state.ts';

/** 创建 validate 到 cleanup 的线性入库 Graph。 */
export function createIngestionGraph(options: IngestionNodeOptions) {
  const nodes = createIngestionNodes(options);
  return new StateGraph(IngestionState)
    .addNode('validate', nodes.validateNode)
    .addNode('parse', nodes.parseNode)
    .addNode('normalize', nodes.normalizeNode)
    .addNode('chunk', nodes.chunkNode)
    .addNode('embed', nodes.embedNode)
    .addNode('publish', nodes.publishNode)
    .addNode('cleanup', nodes.cleanupNode)
    .addEdge(START, 'validate')
    .addEdge('validate', 'parse')
    .addEdge('parse', 'normalize')
    .addEdge('normalize', 'chunk')
    .addEdge('chunk', 'embed')
    .addEdge('embed', 'publish')
    .addEdge('publish', 'cleanup')
    .addEdge('cleanup', END)
    .compile();
}
