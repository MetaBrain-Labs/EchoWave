/**
 * 音频转写仓储测试。
 *
 * 锁定任务创建、SKIP LOCKED 领取、结构化片段发布和旧 active 指针保护边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioAnalysisRepository } from '../../../dist/workspace/persistence/audioAnalysisRepository.js';

const tenantId = '00000000-0000-4000-8000-000000000001';
const audioFileId = '40000000-0000-4000-8000-000000000001';
const revisionId = '50000000-0000-4000-8000-000000000001';

describe('AudioAnalysisRepository', () => {
  it('queues a new revision and claims it with SKIP LOCKED', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/SELECT id, storage_key/.test(sql)) {
          return {
            rowCount: 1,
            rows: [
              {
                id: audioFileId,
                storage_key: 'stored.wav',
                upload_status: 'ready',
                duration_ms: 1_000,
                size_bytes: 1_000,
              },
            ],
          };
        }
        if (/INSERT INTO .*audio_analysis_revisions/.test(sql)) {
          return { rows: [{ id: revisionId }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };
    const pool = {
      connect: async () => client,
      query: async (sql, values) => {
        calls.push({ sql, values });
        return {
          rows: [
            {
              revision_id: revisionId,
              revision_no: 1,
              audio_file_id: audioFileId,
              title: '访谈',
              storage_key: 'stored.wav',
              mime_type: 'audio/wav',
              duration_ms: 1_000,
              size_bytes: 1_000,
              preprocessing_mode: 'whole_file',
              transcription_model: 'qwen-audio-3.0-asr-flash-filetrans',
              transcription_provider: 'dashscope',
              segmentation_mode: 'speaker_turn',
              original_filename: 'meeting.wav',
              ingestion_run_id: '30000000-0000-4000-8000-000000000001',
              data_source_id: '20000000-0000-4000-8000-000000000001',
              data_source_name: '团队录音',
              data_source_type: 'manual_upload',
              data_source_location: 'local',
              data_source_connection_status: 'connected',
            },
          ],
        };
      },
    };
    const repository = new AudioAnalysisRepository(pool, 'echowave', tenantId);

    assert.deepEqual(
      await repository.queueTranscription(
        audioFileId,
        'qwen-audio-3.0-asr-flash-filetrans',
        'whole_file',
        'speaker_turn',
      ),
      { audioFileId, revisionId, status: 'queued' },
    );
    const claimed = await repository.claimTranscription();
    assert.equal(claimed.revisionId, revisionId);
    assert.equal(claimed.preprocessingMode, 'whole_file');
    assert.equal(claimed.originalFilename, 'meeting.wav');
    assert.equal(claimed.dataSource.name, '团队录音');
    assert.equal(claimed.dataSource.connectionStatus, 'connected');
    const insert = calls.find((call) => /INSERT INTO .*audio_analysis_revisions/.test(call.sql));
    assert.equal(insert.values[3], 'whole_file');
    assert.equal(insert.values[4], true);
    assert.equal(insert.values[5], 'segment');
    assert.equal(insert.values[6], 'best_effort');
    assert.match(insert.sql, /'preprocessingMode', \$4::text/);
    assert.match(insert.sql, /'language', 'zh'/);
    assert.match(insert.sql, /'diarizationRequested', \$5::boolean/);
    assert.match(insert.sql, /'businessRole', false/);
    assert.match(insert.sql, /'emotionAnalysis', false/);
    assert.match(insert.sql, /processing_stage, processing_updated_at/);
    assert.match(insert.sql, /'queued', 0, 'queued', now\(\)/);
    assert.ok(calls.some((call) => /FOR UPDATE SKIP LOCKED/.test(call.sql)));
    assert.ok(calls.some((call) => /processing_stage = 'preprocessing'/.test(call.sql)));
  });

  it('updates monotonic chunk activity and clears it when interrupted work is requeued', async () => {
    const calls = [];
    const repository = new AudioAnalysisRepository(
      { query: async (sql, values) => (calls.push({ sql, values }), { rows: [] }) },
      'echowave',
      tenantId,
    );
    const progressJob = {
      audioFileId,
      durationMs: 870_000,
      mimeType: 'audio/wav',
      preprocessingMode: 'whole_file',
      revisionId,
      revisionNo: 1,
      sizeBytes: 1_000,
      storageKey: 'stored.wav',
      title: '访谈',
      originalFilename: 'meeting.wav',
      ingestionRunId: null,
      model: 'qwen-audio-3.0-asr-flash-filetrans',
      provider: 'dashscope',
      segmentationMode: 'speaker_turn',
      dataSource: null,
    };

    await repository.updateActivity(progressJob, {
      stage: 'correcting',
      progress: 43,
      chunkIndex: 2,
      chunkCount: 4,
      chunkStartMs: 238_000,
      chunkEndMs: 482_000,
      networkAttempt: 1,
      structureAttempt: 3,
    });
    await repository.resetInterruptedTranscriptions();

    assert.match(calls[0].sql, /progress = greatest\(progress, \$3\)/);
    assert.deepEqual(calls[0].values.slice(2), [43, 'correcting', 2, 4, 238_000, 482_000, 1, 3]);
    assert.match(calls[1].sql, /processing_stage = 'queued'/);
    assert.match(calls[1].sql, /current_chunk = NULL/);
    assert.match(calls[1].sql, /network_attempt = NULL/);
  });

  it('rejects a removed model before creating a revision', async () => {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(sql);
        if (/SELECT id, storage_key/.test(sql)) {
          return {
            rows: [
              {
                id: audioFileId,
                storage_key: 'legacy.bin',
                upload_status: 'ready',
                duration_ms: 1_000,
                size_bytes: 1_000,
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };
    const repository = new AudioAnalysisRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );

    await assert.rejects(
      () => repository.queueTranscription(audioFileId, 'unknown/model', 'whole_file'),
      (error) => error.code === 'CONFLICT',
    );
    assert.equal(
      calls.some((sql) => /INSERT INTO .*audio_analysis_revisions/.test(sql)),
      false,
    );
    assert.equal(calls.at(-1), 'ROLLBACK');
  });

  it('publishes roles and only switches the active pointer at the end', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/INSERT INTO .*analysis_scenes/.test(sql)) return { rows: [{ id: revisionId }] };
        if (/UPDATE .*audio_files/.test(sql)) return { rowCount: 1, rows: [{ id: audioFileId }] };
        return { rows: [], rowCount: 1 };
      },
      release: () => {},
    };
    const repository = new AudioAnalysisRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );
    const job = {
      audioFileId,
      durationMs: 1_000,
      mimeType: 'audio/wav',
      preprocessingMode: 'whole_file',
      revisionId,
      revisionNo: 1,
      sizeBytes: 1_000,
      storageKey: 'stored.wav',
      title: '访谈',
      originalFilename: 'meeting.wav',
      ingestionRunId: null,
      model: 'qwen-audio-3.0-asr-flash-filetrans',
      provider: 'dashscope',
      segmentationMode: 'speaker_turn',
      dataSource: null,
    };

    await repository.publishTranscription(
      job,
      [
        {
          businessRole: '销售',
          emotion: 'neutral',
          endMs: 900,
          speakerKey: 'Speaker 0',
          startMs: 0,
          text: '您好',
        },
      ],
      {
        language: 'zh',
        diarizationRequested: true,
        diarizationObserved: false,
        responseGranularity: 'chunk',
        segmentationMode: 'speaker_turn',
        speakerIdentityScope: 'none',
      },
    );

    const segmentInsert = calls.find((call) => /INSERT INTO .*transcript_segments/.test(call.sql));
    assert.match(segmentInsert.sql, /business_role/);
    assert.equal(segmentInsert.values[5], '销售');
    const revisionUpdate = calls.findIndex((call) =>
      /UPDATE .*audio_analysis_revisions/.test(call.sql),
    );
    assert.match(calls[revisionUpdate].sql, /'diarizationObserved', \$5::boolean/);
    assert.deepEqual(calls[revisionUpdate].values.slice(2), [
      'zh',
      true,
      false,
      'chunk',
      'speaker_turn',
      'none',
    ]);
    const audioUpdate = calls.findIndex((call) => /UPDATE .*audio_files/.test(call.sql));
    assert.ok(audioUpdate > revisionUpdate);
    assert.equal(calls.at(-1).sql, 'COMMIT');
  });

  it('marks only the failed revision and never updates audio_files', async () => {
    const calls = [];
    const repository = new AudioAnalysisRepository(
      { query: async (sql, values) => (calls.push({ sql, values }), { rows: [] }) },
      'echowave',
      tenantId,
    );
    await repository.failTranscription(
      {
        audioFileId,
        durationMs: 1_000,
        mimeType: 'audio/wav',
        preprocessingMode: 'whole_file',
        revisionId,
        revisionNo: 2,
        sizeBytes: 1_000,
        storageKey: 'stored.wav',
        title: '访谈',
        originalFilename: 'meeting.wav',
        ingestionRunId: null,
        model: 'qwen-audio-3.0-asr-flash-filetrans',
        provider: 'dashscope',
        segmentationMode: 'speaker_turn',
        dataSource: null,
      },
      'MODEL_TIMEOUT',
      '转写模型请求超时。',
      true,
      {
        category: 'timeout',
        chunkIndex: 1,
        chunkCount: 1,
        structureAttempts: 1,
        issues: [{ path: '$', code: 'timeout', message: '模型请求超时。' }],
        outputLength: null,
        outputSha256: null,
      },
    );
    assert.match(calls[0].sql, /error_stage = 'transcription'/);
    assert.match(calls[0].sql, /error_details = \$6::jsonb/);
    assert.equal(JSON.parse(calls[0].values[5]).category, 'timeout');
    assert.doesNotMatch(calls[0].sql, /audio_files/);
  });

  it('persists resumable provider task state and clears only the temporary object key', async () => {
    const calls = [];
    const repository = new AudioAnalysisRepository(
      { query: async (sql, values) => (calls.push({ sql, values }), { rows: [] }) },
      'echowave',
      tenantId,
    );
    const providerJob = {
      audioFileId,
      revisionId,
    };
    const submittedAt = new Date('2026-08-26T00:00:00.000Z');

    await repository.recordProviderArtifact(providerJob, 'temporary/object.mp3');
    await repository.recordProviderTask(providerJob, 'task-1', submittedAt);
    await repository.clearProviderArtifact(providerJob);

    assert.match(calls[0].sql, /SET provider_artifact_key = \$3/);
    assert.deepEqual(calls[0].values, [tenantId, revisionId, 'temporary/object.mp3']);
    assert.match(calls[1].sql, /provider_task_id = \$3, provider_submitted_at = \$4/);
    assert.deepEqual(calls[1].values, [tenantId, revisionId, 'task-1', submittedAt]);
    assert.match(calls[2].sql, /SET provider_artifact_key = NULL/);
    assert.doesNotMatch(calls[2].sql, /provider_task_id = NULL/);
  });
});
