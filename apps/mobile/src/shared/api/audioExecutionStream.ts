/**
 * 音频执行轨迹 SSE 客户端。
 *
 * 使用 Expo 的跨平台流式 fetch 解析服务端事件帧，并在移动端信任边界通过共享契约
 * 校验每一个增量事件。
 *
 * Responsibilities:
 * - 正确处理 UTF-8 与 SSE 帧跨网络分块的情况。
 * - 支持分组作用域、游标续传和显式中止。
 *
 * Notes:
 * - 重连和 REST 降级策略由分析详情页面持有。
 */
import {
  AudioAiExecutionStreamEventSchema,
  type AudioAiExecutionStreamEvent,
} from '@echowave/contracts';
import { fetch } from 'expo/fetch';

import { apiUrl } from './apiUrl';
import { WorkspaceRequestError } from './workspaceApi';

type StreamOptions = {
  audioFileId: string;
  groupId?: string;
  cursor?: string;
  signal: AbortSignal;
  onEvent: (event: AudioAiExecutionStreamEvent) => void;
};

function parseFrame(frame: string): AudioAiExecutionStreamEvent | undefined {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new WorkspaceRequestError('INVALID_RESPONSE', '模型执行实时流返回了无效 JSON。');
  }
  const parsed = AudioAiExecutionStreamEventSchema.safeParse(value);
  if (!parsed.success) {
    throw new WorkspaceRequestError('INVALID_RESPONSE', '模型执行实时流返回了无效事件。');
  }
  return parsed.data;
}

/** 按网络分块增量解码 SSE，并保留跨 UTF-8 字符和跨帧边界的未完成内容。 */
export class AudioExecutionSseParser {
  private readonly decoder = new TextDecoder();
  private buffer = '';

  push(value: Uint8Array): AudioAiExecutionStreamEvent[] {
    this.buffer += this.decoder.decode(value, { stream: true });
    return this.drain(false);
  }

  finish(): AudioAiExecutionStreamEvent[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(flush: boolean): AudioAiExecutionStreamEvent[] {
    const events: AudioAiExecutionStreamEvent[] = [];
    let boundary = this.buffer.match(/\r?\n\r?\n/);
    while (boundary?.index !== undefined) {
      const frame = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const event = parseFrame(frame);
      if (event) events.push(event);
      boundary = this.buffer.match(/\r?\n\r?\n/);
    }
    if (flush && this.buffer.trim()) {
      const event = parseFrame(this.buffer.trim());
      if (event) events.push(event);
      this.buffer = '';
    }
    return events;
  }
}

/** 连接一次模型执行 SSE，直到服务端关闭、网络失败或调用方中止。 */
export async function streamAudioExecutionTrace(options: StreamOptions): Promise<void> {
  const query = new URLSearchParams();
  if (options.groupId) query.set('groupId', options.groupId);
  if (options.cursor) query.set('cursor', options.cursor);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await fetch(
    `${apiUrl}/api/audio-files/${options.audioFileId}/analysis/executions/stream${suffix}`,
    {
      headers: { Accept: 'text/event-stream' },
      signal: options.signal,
    },
  );
  if (!response.ok) {
    throw new WorkspaceRequestError(
      response.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
      `模型执行实时流连接失败（HTTP ${response.status}）。`,
      response.status >= 500,
    );
  }
  if (!response.body) {
    throw new WorkspaceRequestError('INVALID_RESPONSE', '当前环境不支持流式响应。');
  }

  const reader = response.body.getReader();
  const parser = new AudioExecutionSseParser();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(value)) options.onEvent(event);
    }
    for (const event of parser.finish()) options.onEvent(event);
  } finally {
    reader.releaseLock();
  }
}
