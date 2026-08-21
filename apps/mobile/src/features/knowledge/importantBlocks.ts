/**
 * 文档块重点会话状态。
 *
 * 在当前应用会话内共享用户标记的重点文档块，供解析列表与块详情同步展示。
 *
 * Responsibilities:
 * - 保存当前会话的重点块 ID。
 * - 向 React 组件广播重点状态变化。
 *
 * Notes:
 * - 该状态不写入服务器或本地存储，重启应用后清空。
 */
import { useSyncExternalStore } from 'react';

let importantBlockIds: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return importantBlockIds;
}

/** 读取当前会话的重点块集合。 */
export function useImportantBlocks(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 切换指定文档块的重点状态并通知已挂载页面。 */
export function toggleImportantBlock(blockId: string): void {
  const next = new Set(importantBlockIds);
  if (next.has(blockId)) next.delete(blockId);
  else next.add(blockId);
  importantBlockIds = next;
  listeners.forEach((listener) => listener());
}

/** 清空会话级重点状态，仅供测试隔离使用。 */
export function clearImportantBlocksForTests(): void {
  importantBlockIds = new Set();
  listeners.forEach((listener) => listener());
}
