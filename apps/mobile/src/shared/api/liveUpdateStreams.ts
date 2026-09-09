/**
 * 业务状态 SSE 客户端。
 *
 * 使用 Expo 流式 fetch 读取数据源音频、分析状态和知识文档事件，并在共享契约边界校验每一帧。
 *
 * Responsibilities:
 * - 正确处理跨 UTF-8 与 SSE 数据块边界的响应。
 * - 暴露可中止的三类资源实时连接。
 *
 * Notes:
 * - 重连与 REST 降级由持有页面状态的功能组件负责。
 */
import {
  AudioAnalysisStatusStreamEventSchema,
  DataSourceAudioStreamEventSchema,
  KnowledgeDocumentStreamEventSchema,
  type AudioAnalysisStatusStreamEvent,
  type DataSourceAudioStreamEvent,
  type KnowledgeDocumentStreamEvent,
  AudioAnalysisBatchStreamEventSchema,
  type AudioAnalysisBatchStreamEvent,
} from '@echowave/contracts';
import { fetch } from 'expo/fetch';

import { getApiUrl } from './apiUrl';
import { WorkspaceRequestError } from './request';
import { localizeRequestError } from '@/shared/i18n/errorLocalization';

type Parser<T> = (value: unknown) => T;

function parseFrame<T>(frame: string, parse: Parser<T>): T | undefined {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return undefined;
  try {
    return parse(JSON.parse(data));
  } catch {
    throw new WorkspaceRequestError(
      'INVALID_RESPONSE',
      localizeRequestError('INVALID_RESPONSE', '实时状态返回了无效事件。'),
    );
  }
}

/** 按网络块增量解码 SSE，并保留跨块的未完成 UTF-8 字符与事件帧。 */
export class ValidatedSseParser<T> {
  private readonly decoder = new TextDecoder();
  private buffer = '';

  constructor(private readonly parse: Parser<T>) {}

  push(value: Uint8Array): T[] {
    this.buffer += this.decoder.decode(value, { stream: true });
    return this.drain(false);
  }

  finish(): T[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(flush: boolean): T[] {
    const events: T[] = [];
    let boundary = this.buffer.match(/\r?\n\r?\n/);
    while (boundary?.index !== undefined) {
      const frame = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const event = parseFrame(frame, this.parse);
      if (event) events.push(event);
      boundary = this.buffer.match(/\r?\n\r?\n/);
    }
    if (flush && this.buffer.trim()) {
      const event = parseFrame(this.buffer.trim(), this.parse);
      if (event) events.push(event);
      this.buffer = '';
    }
    return events;
  }
}

async function streamValidated<T>(options: {
  path: string;
  signal: AbortSignal;
  parse: Parser<T>;
  onEvent: (event: T) => void;
}): Promise<void> {
  const response = await fetch(`${getApiUrl()}${options.path}`, {
    headers: { Accept: 'text/event-stream' },
    signal: options.signal,
  });
  if (!response.ok) {
    throw new WorkspaceRequestError(
      response.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
      localizeRequestError('HTTP_ERROR', `实时状态连接失败（HTTP ${response.status}）。`),
      response.status >= 500,
    );
  }
  if (!response.body) {
    throw new WorkspaceRequestError(
      'INVALID_RESPONSE',
      localizeRequestError('INVALID_RESPONSE', '当前环境不支持流式响应。'),
    );
  }
  const reader = response.body.getReader();
  const parser = new ValidatedSseParser(options.parse);
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

/** 连接数据源音频处理状态流。 */
export function streamDataSourceAudio(options: {
  dataSourceId: string;
  signal: AbortSignal;
  onEvent: (event: DataSourceAudioStreamEvent) => void;
}) {
  return streamValidated({
    path: `/api/data-sources/${options.dataSourceId}/audio-files/stream`,
    signal: options.signal,
    parse: (value) => DataSourceAudioStreamEventSchema.parse(value),
    onEvent: options.onEvent,
  });
}

/** 连接情绪、角色与业务分析状态流。 */
export function streamAudioAnalysisStatus(options: {
  audioFileId: string;
  groupId?: string;
  signal: AbortSignal;
  onEvent: (event: AudioAnalysisStatusStreamEvent) => void;
}) {
  const query = new URLSearchParams();
  if (options.groupId) query.set('groupId', options.groupId);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return streamValidated({
    path: `/api/audio-files/${options.audioFileId}/analysis/status/stream${suffix}`,
    signal: options.signal,
    parse: (value) => AudioAnalysisStatusStreamEventSchema.parse(value),
    onEvent: options.onEvent,
  });
}

/** 连接知识库文档处理状态流。 */
export function streamKnowledgeDocuments(options: {
  knowledgeBaseId: string;
  signal: AbortSignal;
  onEvent: (event: KnowledgeDocumentStreamEvent) => void;
}) {
  return streamValidated({
    path: `/api/knowledge-bases/${options.knowledgeBaseId}/documents/stream`,
    signal: options.signal,
    parse: (value) => KnowledgeDocumentStreamEventSchema.parse(value),
    onEvent: options.onEvent,
  });
}

/** 连接自动分析批次状态流；断线后的 REST 降级由批次详情页负责。 */
export function streamAudioAnalysisBatch(options: {
  batchId: string;
  signal: AbortSignal;
  onEvent: (event: AudioAnalysisBatchStreamEvent) => void;
}) {
  return streamValidated({
    path: `/api/audio-analysis-batches/${options.batchId}/stream`,
    signal: options.signal,
    parse: (value) => AudioAnalysisBatchStreamEventSchema.parse(value),
    onEvent: options.onEvent,
  });
}
