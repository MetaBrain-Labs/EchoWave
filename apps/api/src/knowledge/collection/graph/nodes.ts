/**
 * 案例收集工作流节点。
 *
 * 命名节点协调来源匹配、投影与音频任务，状态转换写入权威任务表。
 *
 * Responsibilities:
 * - 将业务执行与任务阶段日志绑定。
 *
 * Notes:
 * - 无模型调用，因此不新增模型上下文或提示词。
 */
import type { CollectionService } from '../service.ts';
import type { CollectionState } from './state.ts';
/** 注入应用服务并创建可测试的命名节点。 */
export function createCollectionNodes(service: CollectionService) {
  /** 记录任务进入对应处理阶段。 */
  async function prepareNode({ task }: typeof CollectionState.State) {
    await service.repository.taskState(task, 'running', task.kind);
    return {};
  }
  /** 来源事件按冻结规则执行匹配和幂等保存。 */
  async function collectNode({ task }: typeof CollectionState.State) {
    await service.collectTask(task);
    return {};
  }
  /** 创建既有知识入库工作流的固定输入。 */
  async function projectNode({ task }: typeof CollectionState.State) {
    await service.projectTask(task);
    return {};
  }
  /** 音频失败独立于文本投影。 */
  async function mediaNode({ task }: typeof CollectionState.State) {
    await service.mediaTask(task);
    return {};
  }
  /** 删除采用受控媒体键和可恢复任务。 */
  async function cleanupNode({ task }: typeof CollectionState.State) {
    await service.cleanupTask(task);
    return {};
  }
  /** 成功终态只允许当前租约写回。 */
  async function finishNode({ task }: typeof CollectionState.State) {
    await service.repository.taskState(task, 'completed', 'done');
    return {};
  }
  return { prepareNode, collectNode, projectNode, mediaNode, cleanupNode, finishNode };
}
