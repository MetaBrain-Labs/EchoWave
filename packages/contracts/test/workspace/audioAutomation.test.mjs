/**
 * 一键式音频分析共享契约测试。
 *
 * 锁定批次上限、默认流水线、重复项拒绝和状态枚举。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AudioAnalysisBatchCreateRequestSchema,
  AudioAnalysisTaskStatusSchema,
  PushDeviceRegisterRequestSchema,
} from '../../dist/index.js';

const dataSourceId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';

describe('audio analysis automation contracts', () => {
  it('applies the complete unattended pipeline defaults', () => {
    const parsed = AudioAnalysisBatchCreateRequestSchema.parse({
      source: 'uploads',
      dataSourceId,
      groupId,
      items: [
        { clientItemId: 'first', filename: 'call.wav', mimeType: 'audio/wav', sizeBytes: 10 },
      ],
    });
    assert.deepEqual(parsed.pipeline, {
      confirmation: 'system_raw_snapshot',
      includeEmotion: true,
      includeRole: true,
      includeBusinessAnalysis: true,
      transcriptPolicy: 'reuse_or_create',
    });
    assert.equal(parsed.scheduledFor, null);
    assert.equal(parsed.language, 'zh-CN');
  });

  it('rejects more than twenty items and duplicate existing audio ids', () => {
    const items = Array.from({ length: 21 }, (_, index) => ({
      clientItemId: `item-${index}`,
      filename: `${index}.wav`,
      mimeType: 'audio/wav',
      sizeBytes: 10,
    }));
    assert.equal(
      AudioAnalysisBatchCreateRequestSchema.safeParse({
        source: 'uploads',
        dataSourceId,
        groupId,
        items,
      }).success,
      false,
    );
    assert.equal(
      AudioAnalysisBatchCreateRequestSchema.safeParse({
        source: 'existing_audio',
        dataSourceId,
        groupId,
        audioFileIds: [dataSourceId, dataSourceId],
      }).success,
      false,
    );
  });

  it('keeps the fixed database task status vocabulary', () => {
    assert.deepEqual(AudioAnalysisTaskStatusSchema.options, [
      'awaiting_upload',
      'scheduled',
      'queued',
      'running',
      'hard_blocked',
      'completed',
      'completed_with_warnings',
      'failed',
      'canceled',
    ]);
  });

  it('accepts Expo device tokens and rejects unrelated strings', () => {
    assert.equal(
      PushDeviceRegisterRequestSchema.safeParse({
        token: 'ExponentPushToken[abc_123-XYZ]',
        platform: 'android',
        locale: 'en',
      }).success,
      true,
    );
    assert.equal(
      PushDeviceRegisterRequestSchema.safeParse({
        token: 'ExponentPushToken[abc_123-XYZ]',
        platform: 'android',
        locale: 'fr',
      }).success,
      false,
    );
    assert.equal(
      PushDeviceRegisterRequestSchema.safeParse({ token: 'plain-token', platform: 'ios' }).success,
      false,
    );
  });
});
