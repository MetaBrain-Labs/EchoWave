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
              preprocessing_mode: 'direct',
              transcription_model: 'google/gemini-2.5-flash-lite',
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
      await repository.queueTranscription(audioFileId, 'google/gemini-2.5-flash-lite', 'direct'),
      { audioFileId, revisionId, status: 'queued' },
    );
    const claimed = await repository.claimTranscription();
    assert.equal(claimed.revisionId, revisionId);
    assert.equal(claimed.preprocessingMode, 'direct');
    assert.equal(claimed.originalFilename, 'meeting.wav');
    assert.equal(claimed.dataSource.name, '团队录音');
    assert.equal(claimed.dataSource.connectionStatus, 'connected');
    const insert = calls.find((call) => /INSERT INTO .*audio_analysis_revisions/.test(call.sql));
    assert.equal(insert.values[3], 'direct');
    assert.match(insert.sql, /'preprocessingMode', \$4::text/);
    assert.ok(calls.some((call) => /FOR UPDATE SKIP LOCKED/.test(call.sql)));
  });

  it('rejects an unsupported direct source before creating a revision', async () => {
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
      () => repository.queueTranscription(audioFileId, 'google/gemini-2.5-flash-lite', 'direct'),
      (error) => error.code === 'DIRECT_AUDIO_REJECTED',
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
      preprocessingMode: 'ffmpeg',
      revisionId,
      revisionNo: 1,
      sizeBytes: 1_000,
      storageKey: 'stored.wav',
      title: '访谈',
      originalFilename: 'meeting.wav',
      ingestionRunId: null,
      model: 'google/gemini-2.5-flash-lite',
      dataSource: null,
    };

    await repository.publishTranscription(job, [
      {
        businessRole: '销售',
        emotion: 'neutral',
        endMs: 900,
        speakerKey: 'Speaker 0',
        startMs: 0,
        text: '您好',
      },
    ]);

    const segmentInsert = calls.find((call) => /INSERT INTO .*transcript_segments/.test(call.sql));
    assert.match(segmentInsert.sql, /business_role/);
    assert.equal(segmentInsert.values[5], '销售');
    const revisionUpdate = calls.findIndex((call) =>
      /UPDATE .*audio_analysis_revisions/.test(call.sql),
    );
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
        preprocessingMode: 'direct',
        revisionId,
        revisionNo: 2,
        sizeBytes: 1_000,
        storageKey: 'stored.wav',
        title: '访谈',
        originalFilename: 'meeting.wav',
        ingestionRunId: null,
        model: 'google/gemini-2.5-flash-lite',
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
});
