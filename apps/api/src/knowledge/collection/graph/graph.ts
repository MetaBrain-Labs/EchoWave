/**
 * 案例收集工作流图。
 *
 * 将多阶段案例处理显式组织为命名 LangGraph 节点。
 *
 * Responsibilities:
 * - 按持久任务类型路由到对应业务节点。
 *
 * Notes:
 * - 重启后由 PostgreSQL 任务租约恢复，节点副作用保持幂等。
 */
import { END, START, StateGraph } from '@langchain/langgraph';
import type { CollectionService } from '../service.ts';
import { CollectionState } from './state.ts';
import { createCollectionNodes } from './nodes.ts';
/** 创建独立于模型和网络传输的收集工作流。 */
export function createCollectionGraph(service: CollectionService) {
  const nodes = createCollectionNodes(service);
  return new StateGraph(CollectionState)
    .addNode('prepare', nodes.prepareNode)
    .addNode('source', nodes.collectNode)
    .addNode('projection', nodes.projectNode)
    .addNode('media', nodes.mediaNode)
    .addNode('cleanup', nodes.cleanupNode)
    .addNode('finish', nodes.finishNode)
    .addEdge(START, 'prepare')
    .addConditionalEdges('prepare', ({ task }) => task.kind, [
      'source',
      'projection',
      'media',
      'cleanup',
    ])
    .addEdge('source', 'finish')
    .addEdge('projection', 'finish')
    .addEdge('media', 'finish')
    .addEdge('cleanup', 'finish')
    .addEdge('finish', END)
    .compile();
}
