/**
 * 音频核心 PostgreSQL Repository 测试。
 *
 * 验证播放元数据访问和当前已发布分析详情恢复。
 *
 * Responsibilities:
 * - 锁定音频租户约束及上传状态校验。
 * - 验证转写能力和确认状态投影。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PostgresAudioCoreRepository } from '../../../dist/workspace/audio/core/postgresAudioCoreRepository.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const audioId = '33333333-3333-4333-8333-333333333333';
const knowledgeId = '44444444-4444-4444-8444-444444444444';

describe('PostgresAudioCoreRepository audio playback', () => {
  it('returns only tenant-scoped ready audio storage metadata', async () => {
    const calls = [];
    const repository = new PostgresAudioCoreRepository(
      {
        query: async (sql, values) => {
          calls.push({ sql, values });
          return {
            rows: [
              {
                storage_key: 'stored.wav',
                mime_type: 'audio/wav',
                original_filename: '客户访谈.wav',
                upload_status: 'ready',
              },
            ],
          };
        },
      },
      'echowave',
      tenantId,
    );

    assert.deepEqual(await repository.getAudioPlaybackSource(audioId), {
      storageKey: 'stored.wav',
      mimeType: 'audio/wav',
      originalFilename: '客户访谈.wav',
    });
    assert.deepEqual(calls[0].values, [tenantId, audioId]);
    assert.match(calls[0].sql, /deleted_at IS NULL/);
  });

  it('rejects archived, cross-tenant, and unfinished audio without exposing storage', async () => {
    const missing = new PostgresAudioCoreRepository(
      { query: async () => ({ rows: [] }) },
      'echowave',
      tenantId,
    );
    await assert.rejects(() => missing.getAudioPlaybackSource(audioId), /不存在或已归档/);

    const unfinished = new PostgresAudioCoreRepository(
      {
        query: async () => ({
          rows: [{ storage_key: null, upload_status: 'uploading' }],
        }),
      },
      'echowave',
      tenantId,
    );
    await assert.rejects(() => unfinished.getAudioPlaybackSource(audioId), /尚未完成上传/);
  });
});

describe('PostgresAudioCoreRepository audio analysis metadata', () => {
  it('exposes the selected model and actually observed diarization state', async () => {
    const pool = {
      query: async (sql) => {
        if (/JOIN .*audio_analysis_revisions/.test(sql)) {
          return {
            rows: [
              {
                id: knowledgeId,
                audio_file_id: audioId,
                revision_no: 3,
                published_at: new Date('2026-08-25T01:00:00.000Z'),
                transcription_model: 'openai/gpt-4o-mini-transcribe',
                settings_snapshot: {
                  language: 'zh',
                  diarizationRequested: true,
                  diarizationObserved: false,
                  responseGranularity: 'chunk',
                },
                active_transcript_confirmation_id: knowledgeId,
                confirmation_version: 2,
                confirmed_at: new Date('2026-08-25T01:02:00.000Z'),
                title: '客户通话',
                duration_ms: 45_000,
              },
            ],
          };
        }
        if (/analysis_scenes/.test(sql)) {
          return {
            rows: [
              {
                scene_id: groupId,
                scene_index: 1,
                scene_title: '完整录音',
                scene_start_ms: 0,
                segment_id: audioId,
                segment_index: 1,
                speaker_key: 'Speaker 0',
                speaker_label: 'unknown',
                business_role: 'unknown',
                emotion: 'unknown',
                start_ms: 0,
                end_ms: 45_000,
                raw_text: '您好呀。',
                confirmed_text: '您好。',
                tag_id: null,
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const repository = new PostgresAudioCoreRepository(pool, 'echowave', tenantId);

    const response = await repository.getAudioAnalysis(audioId);

    assert.deepEqual(response.transcription, {
      model: 'openai/gpt-4o-mini-transcribe',
      language: 'zh',
      diarizationStatus: 'not_returned',
      preprocessingMode: 'whole_file',
      responseGranularity: 'chunk',
      segmentationMode: 'readable',
      speakerIdentityScope: 'none',
    });
    assert.deepEqual(response.transcriptConfirmation, {
      status: 'confirmed',
      currentVersion: 2,
      confirmedAt: '2026-08-25T01:02:00.000Z',
    });
    assert.equal(response.scenes[0].segments[0].rawText, '您好呀。');
    assert.equal(response.scenes[0].segments[0].confirmedText, '您好。');
  });
});
