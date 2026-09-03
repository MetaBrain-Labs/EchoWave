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
                size_bytes: 1024,
                source_state: 'available',
                storage_backend: 'local_persistent',
                storage_binding_revision_id: null,
                updated_at: '2026-09-03T08:00:00.000Z',
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
      sizeBytes: 1024,
      sourceState: 'available',
      storageBackend: 'local_persistent',
      storageBindingRevisionId: null,
      updatedAt: new Date('2026-09-03T08:00:00.000Z'),
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
          rows: [{ storage_key: null, upload_status: 'uploading', source_state: 'available' }],
        }),
      },
      'echowave',
      tenantId,
    );
    await assert.rejects(() => unfinished.getAudioPlaybackSource(audioId), /尚未完成上传/);
  });
});

describe('PostgresAudioCoreRepository speaker review resolution', () => {
  it('deletes one or all findings only from the active tenant-scoped revision', async () => {
    const calls = [];
    const repository = new PostgresAudioCoreRepository(
      {
        query: async (sql, values) => {
          calls.push({ sql, values });
          return { rows: [{ audio_exists: true, resolved_count: values.length === 3 ? 1 : 4 }] };
        },
      },
      'echowave',
      tenantId,
    );

    assert.equal(await repository.resolveSpeakerReviewFinding(audioId, knowledgeId), 1);
    assert.equal(await repository.resolveAllSpeakerReviewFindings(audioId), 4);
    assert.deepEqual(calls[0].values, [tenantId, audioId, knowledgeId]);
    assert.deepEqual(calls[1].values, [tenantId, audioId]);
    assert.match(calls[0].sql, /active_analysis_revision_id/);
    assert.match(calls[0].sql, /speaker_review_resolved_at/);
    assert.match(calls[0].sql, /finding\.tenant_id = \$1/);
    assert.match(calls[1].sql, /DELETE FROM .*speaker_review_findings/);
  });

  it('rejects resolution when the audio is absent from the current tenant', async () => {
    const repository = new PostgresAudioCoreRepository(
      { query: async () => ({ rows: [{ audio_exists: false, resolved_count: 0 }] }) },
      'echowave',
      tenantId,
    );

    await assert.rejects(
      () => repository.resolveAllSpeakerReviewFindings(audioId),
      /不存在或已归档/,
    );
  });
});

describe('PostgresAudioCoreRepository audio analysis metadata', () => {
  it('exposes the selected model and actually observed diarization state', async () => {
    const calls = [];
    const pool = {
      query: async (sql, values) => {
        calls.push({ sql, values });
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
                speaker_review_resolved_at: new Date('2026-08-25T01:03:00.000Z'),
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
      expectedSpeakerCount: null,
      preprocessingMode: 'whole_file',
      responseGranularity: 'chunk',
      segmentationMode: 'readable',
      speakerIdentityScope: 'none',
    });
    assert.deepEqual(response.transcriptConfirmation, {
      status: 'confirmed',
      currentVersion: 2,
      confirmedAt: '2026-08-25T01:02:00.000Z',
      origin: 'user_confirmed',
    });
    assert.equal(response.speakerReview.resolvedAt, '2026-08-25T01:03:00.000Z');
    assert.equal(response.scenes[0].segments[0].rawText, '您好呀。');
    assert.equal(response.scenes[0].segments[0].confirmedText, '您好。');
    const confirmedSegmentsQuery = calls.find(({ sql }) =>
      /FROM .*transcript_confirmation_segments.* confirmed/s.test(sql),
    );
    assert.ok(confirmedSegmentsQuery);
    assert.doesNotMatch(confirmedSegmentsQuery.sql, /\$5/);
    assert.deepEqual(confirmedSegmentsQuery.values, [tenantId, undefined, undefined, knowledgeId]);
  });

  it('projects lightweight bundled acoustic emotion onto the active confirmation', async () => {
    const emotionJobId = '55555555-5555-4555-8555-555555555555';
    const confirmationId = '66666666-6666-4666-8666-666666666666';
    const segmentId = '77777777-7777-4777-8777-777777777777';
    const pool = {
      query: async (sql) => {
        if (/JOIN .*audio_analysis_revisions/.test(sql)) {
          return {
            rows: [
              {
                id: knowledgeId,
                audio_file_id: audioId,
                revision_no: 1,
                published_at: new Date('2026-09-03T01:00:00.000Z'),
                transcription_model: 'qwen-audio-3.0-asr-flash-filetrans',
                settings_snapshot: { language: 'zh', diarizationRequested: true },
                active_transcript_confirmation_id: confirmationId,
                active_emotion_job_id: emotionJobId,
                bundled_emotion_job_id: emotionJobId,
                include_acoustic_emotion: true,
                speaker_review_resolved_at: null,
                confirmation_version: 2,
                confirmation_origin: 'user_confirmed',
                confirmed_at: new Date('2026-09-03T01:02:00.000Z'),
                runtime_mode: 'lightweight_local',
                source_state: 'cleaned',
                source_recovery_state: 'not_required',
                source_delete_after: new Date('2026-09-03T01:03:00.000Z'),
                title: '轻量本地录音',
                duration_ms: 2_000,
              },
            ],
          };
        }
        if (/transcript_confirmation_segments/.test(sql)) {
          return {
            rows: [
              {
                scene_id: groupId,
                scene_index: 1,
                scene_title: '完整录音',
                scene_start_ms: 0,
                segment_id: segmentId,
                segment_index: 1,
                speaker_key: 'Speaker 0',
                start_word_index: 0,
                end_word_index: 1,
                start_ms: 0,
                end_ms: 2_000,
                confirmed_text: '您好。',
                source_segment_id: segmentId,
                raw_text: '您好。',
                words: [],
                emotion_label: 'happy',
                emotion_confidence: 0.91,
                attitude: 'cooperative',
                arousal: 'medium',
                pace: 'normal',
                volume_trend: 'rising',
                pitch_variation: 'medium',
                pause_pattern: 'few',
                vocal_cues: ['笑声'],
                emotion_model: 'qwen3.5-omni-flash',
                role_kind: null,
                role_label: null,
                role_confidence: null,
                evidence_segment_ids: null,
                role_model: null,
              },
            ],
          };
        }
        if (/analysis_scenes/.test(sql)) {
          return { rows: [] };
        }
        if (/DISTINCT ON \(job.analysis_type\)/.test(sql)) {
          return {
            rows: [
              {
                id: emotionJobId,
                analysis_type: 'emotion',
                model: 'qwen3.5-omni-flash',
                status: 'ready',
                progress: 100,
                completed_at: new Date('2026-09-03T01:02:30.000Z'),
                error_code: null,
                error_message: null,
                error_retryable: null,
                confirmation_version: 1,
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const repository = new PostgresAudioCoreRepository(pool, 'echowave', tenantId);

    const response = await repository.getAudioAnalysis(audioId);

    assert.equal(response.runtimeMode, 'lightweight_local');
    assert.equal(response.sourceState, 'cleaned');
    assert.deepEqual(response.transcriptConfirmation, {
      status: 'confirmed',
      currentVersion: 2,
      confirmedAt: '2026-09-03T01:02:00.000Z',
      origin: 'user_confirmed',
    });
    assert.deepEqual(response.postAnalysis.emotion, {
      state: 'ready',
      jobId: emotionJobId,
      model: 'qwen3.5-omni-flash',
      completedAt: '2026-09-03T01:02:30.000Z',
      confirmationVersion: 2,
    });
    assert.deepEqual(response.scenes[0].segments[0].emotionAnalysis, {
      label: 'happy',
      confidence: 0.91,
      attitude: 'cooperative',
      arousal: 'medium',
      pace: 'normal',
      volumeTrend: 'rising',
      pitchVariation: 'medium',
      pausePattern: 'few',
      vocalCues: ['笑声'],
      model: 'qwen3.5-omni-flash',
    });
  });
});
