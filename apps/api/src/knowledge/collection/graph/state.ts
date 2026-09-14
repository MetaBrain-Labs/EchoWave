/**
 * 案例收集工作流状态。
 *
 * 持久任务提供恢复定位，节点仅传递不可变任务快照。
 *
 * Responsibilities:
 * - 声明工作流输入边界。
 *
 * Notes:
 * - 案例与阶段进度仍由 PostgreSQL 保存。
 */
import { Annotation } from '@langchain/langgraph';
import type { CollectionTask } from '../repository.ts';
/** 一个可重复执行并由数据库去重的任务。 */
export const CollectionState = Annotation.Root({ task: Annotation<CollectionTask>() });
