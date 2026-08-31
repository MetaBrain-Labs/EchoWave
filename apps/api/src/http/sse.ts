/**
 * HTTP SSE 公共传输能力。
 *
 * 统一实时路由的响应头、游标和事件写入格式，不拥有任何领域事件或订阅规则。
 *
 * Responsibilities:
 * - 配置禁止代理缓冲的 SSE 响应头。
 * - 生成单进程递增临时游标和事件时间。
 * - 统一写入 JSON SSE 事件。
 *
 * Notes:
 * - 数据库快照仍是断线恢复的权威来源。
 */
import type { Context } from 'hono';

let liveCursor = BigInt(Date.now()) * 1_000n;

/** 为非持久实时事件生成单进程递增标识。 */
export function nextLiveCursor(): string {
  liveCursor += 1n;
  return liveCursor.toString();
}

/** 返回事件发生时间。 */
export function occurredAt(): string {
  return new Date().toISOString();
}

/** 配置所有实时端点共享的响应头。 */
export function prepareSse(context: Context): void {
  context.header('Cache-Control', 'private, no-cache, no-transform');
  context.header('Content-Encoding', 'Identity');
  context.header('X-Accel-Buffering', 'no');
}

/** 将带 cursor/type 的领域事件写为 JSON SSE。 */
export async function writeJsonSse(
  stream: { writeSSE(input: { id: string; event: string; data: string }): Promise<unknown> },
  event: { cursor: string; type: string },
): Promise<void> {
  await stream.writeSSE({ id: event.cursor, event: event.type, data: JSON.stringify(event) });
}
