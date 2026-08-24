/**
 * 音频分块合并测试。
 *
 * 验证全局时间偏移、重叠归属和 Speaker 连续编号。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeChunkSegments } from '../../../dist/workspace/transcription/worker.js';

describe('audio transcription merge', () => {
  it('keeps one overlap copy and normalizes speakers by first appearance', () => {
    const segments = mergeChunkSegments(
      [
        {
          chunk: {
            path: 'one.mp3',
            durationMs: 602_000,
            format: 'mp3',
            offsetMs: 0,
            primaryStartMs: 0,
            primaryEndMs: 600_000,
          },
          result: {
            speakers: [{ speakerKey: 'Speaker 4', businessRole: '销售' }],
            segments: [
              {
                speakerKey: 'Speaker 4',
                emotion: 'neutral',
                startMs: 599_000,
                endMs: 601_000,
                text: '跨段内容',
              },
            ],
          },
        },
        {
          chunk: {
            path: 'two.mp3',
            durationMs: 12_000,
            format: 'mp3',
            offsetMs: 598_000,
            primaryStartMs: 600_000,
            primaryEndMs: 610_000,
          },
          result: {
            speakers: [{ speakerKey: 'Speaker 4', businessRole: '销售' }],
            segments: [
              {
                speakerKey: 'Speaker 4',
                emotion: 'neutral',
                startMs: 1_000,
                endMs: 3_000,
                text: '跨段内容',
              },
              {
                speakerKey: 'Speaker 4',
                emotion: 'happy',
                startMs: 4_000,
                endMs: 6_000,
                text: '下一句',
              },
            ],
          },
        },
      ],
      610_000,
    );

    assert.deepEqual(
      segments.map(({ speakerKey, startMs, text }) => ({ speakerKey, startMs, text })),
      [
        { speakerKey: 'Speaker 0', startMs: 599_000, text: '跨段内容' },
        { speakerKey: 'Speaker 0', startMs: 602_000, text: '下一句' },
      ],
    );
  });

  it('deduplicates text-similar overlap copies when timestamps drift across the boundary', () => {
    const segments = mergeChunkSegments(
      [
        {
          chunk: {
            path: 'one.mp3',
            durationMs: 602_000,
            format: 'mp3',
            offsetMs: 0,
            primaryStartMs: 0,
            primaryEndMs: 600_000,
          },
          result: {
            speakers: [{ speakerKey: 'Speaker 0', businessRole: '客户' }],
            segments: [
              {
                speakerKey: 'Speaker 0',
                emotion: 'neutral',
                startMs: 598_800,
                endMs: 599_900,
                text: '这个方案可以接受',
              },
            ],
          },
        },
        {
          chunk: {
            path: 'two.mp3',
            durationMs: 12_000,
            format: 'mp3',
            offsetMs: 598_000,
            primaryStartMs: 600_000,
            primaryEndMs: 610_000,
          },
          result: {
            speakers: [{ speakerKey: 'Speaker 0', businessRole: '客户' }],
            segments: [
              {
                speakerKey: 'Speaker 0',
                emotion: 'neutral',
                startMs: 1_300,
                endMs: 3_100,
                text: '这个方案，可以接受',
              },
            ],
          },
        },
      ],
      610_000,
    );

    assert.equal(segments.length, 1);
    assert.equal(segments[0].text, '这个方案，可以接受');
  });
});
