/**
 * 后置分析仓储测试。
 *
 * 验证任务快照、原子指针发布和失败不修改既有 active 结果。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PostAnalysisRepository } from '../../../dist/workspace/audio/post-analysis/repository.js';

const tenantId = '00000000-0000-4000-8000-000000000001';
const audioId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const confirmationId = '44444444-4444-4444-8444-444444444444';

describe('PostAnalysisRepository', () => {
  it('queues against the active revision and snapshots custom roles', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/SELECT af.active_analysis_revision_id/.test(sql))
          return {
            rows: [
              {
                revision_id: revisionId,
                confirmation_id: confirmationId,
                confirmation_version: 2,
                custom_business_roles: ['售后'],
              },
            ],
          };
        if (/INSERT INTO/.test(sql)) return { rows: [{ id: jobId }] };
        return { rows: [] };
      },
      release: () => {},
    };
    const repository = new PostAnalysisRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );
    const result = await repository.queue(audioId, 'role', 'deepseek-v4-flash');
    assert.equal(result.revisionId, revisionId);
    assert.equal(result.jobId, jobId);
    assert.equal(calls.at(-1).sql, 'COMMIT');
    const insert = calls.find(({ sql }) => /INSERT INTO/.test(sql));
    assert.equal(insert.values[3], confirmationId);
    assert.equal(insert.values[6], '["售后"]');
  });

  it('rejects post-analysis before the current transcript is confirmed', async () => {
    const client = {
      query: async (sql) =>
        /SELECT af.active_analysis_revision_id/.test(sql)
          ? { rows: [{ revision_id: revisionId, confirmation_id: null }] }
          : { rows: [] },
      release: () => {},
    };
    const repository = new PostAnalysisRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );
    await assert.rejects(
      () => repository.queue(audioId, 'role', 'deepseek-v4-flash'),
      (error) => error.code === 'CONFLICT' && /先确认转写正文/.test(error.message),
    );
  });

  it('claims the confirmation snapshot pinned when the task was queued', async () => {
    const repository = new PostAnalysisRepository(
      {
        query: async (sql) => {
          if (/WITH candidate/.test(sql)) {
            return {
              rows: [
                {
                  id: jobId,
                  analysis_type: 'role',
                  model: 'deepseek-v4-flash',
                  audio_file_id: audioId,
                  analysis_revision_id: revisionId,
                  transcript_confirmation_id: confirmationId,
                  confirmation_version: 2,
                  input_snapshot: { customBusinessRoles: ['售后'] },
                  storage_key: 'audio.mp3',
                  duration_ms: 1_000,
                  deleted_at: null,
                },
              ],
            };
          }
          if (/transcript_confirmation_segments/.test(sql)) {
            return {
              rows: [
                {
                  id: audioId,
                  speaker_key: 'Speaker 0',
                  start_ms: 0,
                  end_ms: 1_000,
                  text: '用户确认后的专有名词',
                },
              ],
            };
          }
          return { rows: [] };
        },
      },
      'echowave',
      tenantId,
    );

    const job = await repository.claim('role');
    assert.equal(job.confirmationId, confirmationId);
    assert.equal(job.confirmationVersion, 2);
    assert.equal(job.segments[0].text, '用户确认后的专有名词');
  });

  it('publishes the new pointer only after writing all results', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rowCount: /active_role_job_id/.test(sql) ? 1 : 1, rows: [{ id: revisionId }] };
      },
      release: () => {},
    };
    const repository = new PostAnalysisRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );
    const job = {
      id: jobId,
      type: 'role',
      model: 'deepseek-v4-flash',
      audioFileId: audioId,
      revisionId,
      storageKey: 'a.mp3',
      durationMs: 1_000,
      customBusinessRoles: [],
      confirmationId,
      confirmationVersion: 1,
      segments: [],
    };
    await repository.publishRoles(job, [
      {
        speakerKey: 'Speaker 0',
        kind: 'customer',
        label: '客户',
        confidence: 0.9,
        evidenceSegmentIds: [],
        model: 'deepseek-v4-flash',
      },
    ]);
    assert.ok(calls.find(({ sql }) => /INSERT INTO .*speaker_role_results/.test(sql)));
    assert.ok(calls.find(({ sql }) => /SET active_role_job_id = \$3/.test(sql)));
    assert.equal(calls.at(-1).sql, 'COMMIT');
  });

  it('records failure without changing either active pointer', async () => {
    let statement = '';
    const repository = new PostAnalysisRepository(
      {
        query: async (sql) => {
          statement = sql;
          return { rows: [] };
        },
      },
      'echowave',
      tenantId,
    );
    await repository.fail(jobId, 'PROVIDER_ERROR', '暂时不可用', true);
    assert.match(statement, /SET status = 'failed'/);
    assert.doesNotMatch(statement, /active_emotion_job_id|active_role_job_id/);
  });

  it('turns an archived queued audio into a terminal safe failure', async () => {
    const calls = [];
    const repository = new PostAnalysisRepository(
      {
        query: async (sql, values) => {
          calls.push({ sql, values });
          if (/WITH candidate/.test(sql)) {
            return {
              rows: [
                {
                  id: jobId,
                  analysis_type: 'emotion',
                  model: 'qwen3.5-omni-flash',
                  audio_file_id: audioId,
                  analysis_revision_id: revisionId,
                  transcript_confirmation_id: confirmationId,
                  confirmation_version: 1,
                  input_snapshot: {},
                  storage_key: 'audio.mp3',
                  duration_ms: 1_000,
                  deleted_at: new Date(),
                },
              ],
            };
          }
          return { rows: [] };
        },
      },
      'echowave',
      tenantId,
    );

    assert.equal(await repository.claim('emotion'), undefined);
    const failure = calls.find(({ sql }) => /SET status = 'failed'/.test(sql));
    assert.equal(failure.values[2], 'CONFLICT');
    assert.equal(failure.values[4], false);
  });
});
