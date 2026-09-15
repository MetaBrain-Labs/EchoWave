/**
 * 录音暂存与仅转写契约回归。
 *
 * 验证兼容默认值、人工确认边界和本机文件定位约束。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AudioUploadSessionCreateRequestSchema,
  AudioAnalysisBatchCreateRequestSchema,
  RecordingDraftSchema,
} from '../../dist/index.js';
const id = '11111111-1111-4111-8111-111111111111';
describe('recording contracts', () => {
  it('keeps legacy upload defaults and accepts explicit archive intent', () => {
    const input = { filename: 'recording.m4a', mimeType: 'audio/mp4', sizeBytes: 1024 };
    assert.equal(AudioUploadSessionCreateRequestSchema.parse(input).postUploadAction, 'transcribe');
    assert.equal(
      AudioUploadSessionCreateRequestSchema.parse({
        ...input,
        postUploadAction: 'store_only',
        idempotencyKey: 'phone-draft-1',
      }).postUploadAction,
      'store_only',
    );
    assert.equal(
      AudioUploadSessionCreateRequestSchema.safeParse({ ...input, idempotencyKey: '' }).success,
      false,
    );
  });
  it('only permits manual confirmation without automatic downstream analyses', () => {
    const input = {
      source: 'existing_audio',
      audioFileIds: [id],
      dataSourceId: id,
      groupId: id,
      pipeline: {
        confirmation: 'manual',
        includeEmotion: false,
        includeRole: false,
        includeBusinessAnalysis: false,
      },
    };
    assert.equal(
      AudioAnalysisBatchCreateRequestSchema.parse(input).pipeline.confirmation,
      'manual',
    );
    for (const flag of ['includeEmotion', 'includeRole', 'includeBusinessAnalysis'])
      assert.equal(
        AudioAnalysisBatchCreateRequestSchema.safeParse({
          ...input,
          pipeline: { ...input.pipeline, [flag]: true },
        }).success,
        false,
      );
  });
  it('rejects local draft traversal and invalid versions', () => {
    const draft = {
      version: 1,
      id,
      title: '访谈',
      createdAt: '2026-09-15T00:00:00.000Z',
      path: 'recordings/original.m4a',
      durationMs: 1000,
      sizeBytes: 10,
      serverUrl: 'https://example.com',
      dataSourceId: id,
      interrupted: false,
      state: 'local',
    };
    assert.equal(RecordingDraftSchema.safeParse(draft).success, true);
    for (const path of ['../other.m4a', '/etc/audio.m4a', 'file:///other.m4a'])
      assert.equal(RecordingDraftSchema.safeParse({ ...draft, path }).success, false);
    assert.equal(RecordingDraftSchema.safeParse({ ...draft, version: 2 }).success, false);
  });
});
