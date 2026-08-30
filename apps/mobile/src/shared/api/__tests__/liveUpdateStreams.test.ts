/**
 * 业务状态 SSE 解析测试。
 *
 * 验证通用解析器能够处理跨 UTF-8 和网络块边界的实时状态事件。
 *
 * Responsibilities:
 * - 锁定共享 SSE 解码器的分块与契约拒绝行为。
 */
import { DataSourceAudioStreamEventSchema } from '@echowave/contracts';

import { ValidatedSseParser } from '../liveUpdateStreams';

describe('ValidatedSseParser', () => {
  it('parses a Chinese status event across UTF-8 chunks', () => {
    const parser = new ValidatedSseParser((value) => DataSourceAudioStreamEventSchema.parse(value));
    const event = {
      type: 'audio-file',
      cursor: '2',
      occurredAt: '2026-08-30T01:00:00.000Z',
      dataSourceId: '11111111-1111-4111-8111-111111111111',
      audioFileId: '22222222-2222-4222-8222-222222222222',
      terminal: false,
      item: {
        id: '22222222-2222-4222-8222-222222222222',
        sourceId: '11111111-1111-4111-8111-111111111111',
        title: '客户访谈',
        durationMs: 1_000,
        createdAt: '2026-08-30T01:00:00.000Z',
        sharedFrom: null,
        hasTranscript: false,
        status: { kind: 'transcribing', progress: 35, activity: null },
      },
    } as const;
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(event)}\r\n\r\n`);
    const decoded = [
      ...parser.push(bytes.slice(0, 23)),
      ...parser.push(bytes.slice(23, 57)),
      ...parser.push(bytes.slice(57)),
      ...parser.finish(),
    ];
    expect(decoded).toEqual([event]);
  });

  it('rejects malformed final frames', () => {
    const parser = new ValidatedSseParser((value) => DataSourceAudioStreamEventSchema.parse(value));
    parser.push(new TextEncoder().encode('data: {"type":"audio-file"}'));
    expect(() => parser.finish()).toThrow('无效事件');
  });
});
