/**
 * 音频工作区共享契约测试。
 *
 * 验证统一处理状态和嵌套分析详情能够拒绝越界或时间顺序错误的数据。
 *
 * Responsibilities:
 * - 锁定移动端与 API 的新网络边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AudioAnalysisDetailSchema,
  AudioFileSummarySchema,
  DataSourceDetailSchema,
  GroupCreateRequestSchema,
} from '../../dist/index.js';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const thirdId = '33333333-3333-4333-8333-333333333333';

describe('workspace contracts', () => {
  it('trims valid group names and rejects empty or oversized names', () => {
    assert.deepEqual(GroupCreateRequestSchema.parse({ name: '  客户研究组  ' }), {
      name: '客户研究组',
    });
    assert.throws(() => GroupCreateRequestSchema.parse({ name: '   ' }));
    assert.throws(() => GroupCreateRequestSchema.parse({ name: '分'.repeat(121) }));
    assert.throws(() => GroupCreateRequestSchema.parse({ name: 42 }));
  });

  it('validates structured audio failure states and progress bounds', () => {
    const audio = AudioFileSummarySchema.parse({
      id: firstId,
      sourceId: null,
      title: '访谈',
      durationMs: 1_000,
      createdAt: '2026-08-21T10:00:00.000Z',
      sharedFrom: null,
      status: {
        kind: 'failed',
        stage: 'transcription',
        code: 'UNSUPPORTED_CODEC',
        message: '编码不支持。',
        retryable: false,
      },
    });

    assert.equal(audio.status.kind, 'failed');
    assert.throws(() =>
      AudioFileSummarySchema.parse({
        ...audio,
        status: { kind: 'analyzing', progress: 101 },
      }),
    );
  });

  it('validates data-source settings without accepting credentials', () => {
    const source = DataSourceDetailSchema.parse({
      id: firstId,
      name: '团队录音空间',
      description: '',
      sourceType: 'manual_upload',
      location: 'local',
      connectionLabel: '手动上传',
      connectionStatus: 'connected',
      linkedGroupCount: 1,
      lastUploadedAt: null,
      metrics: { audioCount: 0, totalDurationMs: 0, transcribedCount: 0, pendingCount: 0 },
      settings: {
        transcriptionModel: 'Echo ASR Standard',
        autoTranscribe: true,
        emotionAnalysis: true,
        speakerDiarization: true,
        sceneSegmentation: true,
        skipInvalidAudio: true,
      },
      apiKey: 'must-be-stripped',
    });

    assert.equal('apiKey' in source, false);
  });

  it('rejects reversed transcript and invalid-segment time ranges', () => {
    const detail = {
      id: firstId,
      audioFileId: secondId,
      revision: 1,
      title: '产品访谈分析',
      durationMs: 10_000,
      generatedAt: '2026-08-21T10:00:00.000Z',
      scenes: [
        {
          id: thirdId,
          index: 1,
          title: '开场',
          startMs: 0,
          segments: [
            {
              id: firstId,
              index: 1,
              speakerKey: 'host',
              speakerLabel: '主持人',
              emotion: '专注',
              startMs: 0,
              endMs: 1_000,
              text: '你好。',
              aiTag: null,
            },
          ],
        },
      ],
      invalidSegments: [],
      summarySections: [],
    };

    assert.equal(AudioAnalysisDetailSchema.parse(detail).scenes.length, 1);
    assert.throws(() =>
      AudioAnalysisDetailSchema.parse({
        ...detail,
        scenes: [
          {
            ...detail.scenes[0],
            segments: [{ ...detail.scenes[0].segments[0], startMs: 1_000, endMs: 500 }],
          },
        ],
      }),
    );
  });
});
