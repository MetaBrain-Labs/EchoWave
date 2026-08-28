/**
 * 分组业务分析仓储测试。
 *
 * 验证确认版、设置与知识库关联会被固定进任务，并锁定幂等和安全发布语义。
 *
 * Responsibilities:
 * - 覆盖默认复用、强制重跑、分组访问门槛与发布指针保护。
 *
 * Notes:
 * - 使用窄 SQL 假对象验证事务边界，不连接真实 PostgreSQL。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BusinessAnalysisRepository } from '../../../dist/workspace/persistence/businessAnalysisRepository.js';

const tenantId = '00000000-0000-4000-8000-000000000001';
const groupId = '11111111-1111-4111-8111-111111111111';
const audioId = '22222222-2222-4222-8222-222222222222';
const revisionId = '33333333-3333-4333-8333-333333333333';
const confirmationId = '44444444-4444-4444-8444-444444444444';
const knowledgeBaseId = '55555555-5555-4555-8555-555555555555';
const jobId = '66666666-6666-4666-8666-666666666666';

function snapshotRow() {
  return {
    audio_file_id: audioId,
    revision_id: revisionId,
    confirmation_id: confirmationId,
    confirmation_version: 3,
    settings_updated_at: new Date('2026-08-28T08:00:00.000Z'),
    analysis_timing: 'manual',
    content_focus: '关注异议处理',
    tone: '正式、专业',
    custom_tags: ['需求探索'],
    emotion_job_id: null,
    role_job_id: null,
  };
}

function queueClient({ existing = undefined } = {}) {
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (/SELECT af\.id AS audio_file_id/.test(sql)) return { rows: [snapshotRow()] };
      if (/SELECT gkb\.knowledge_base_id/.test(sql)) {
        return { rows: [{ knowledge_base_id: knowledgeBaseId }] };
      }
      if (/SELECT id, status FROM/.test(sql)) return { rows: existing ? [existing] : [] };
      if (/INSERT INTO .*audio_business_analysis_jobs/.test(sql)) return { rows: [{ id: jobId }] };
      return { rows: [] };
    },
    release: () => {},
  };
  return { calls, client };
}

describe('BusinessAnalysisRepository', () => {
  it('reuses the same completed snapshot unless force is requested', async () => {
    const reusedClient = queueClient({ existing: { id: jobId, status: 'ready' } });
    const repository = new BusinessAnalysisRepository(
      { connect: async () => reusedClient.client },
      'echowave',
      tenantId,
    );
    const reused = await repository.queue(audioId, groupId, 'deepseek-v4-flash');
    assert.equal(reused.reused, true);
    assert.equal(reused.status, 'ready');
    assert.equal(
      reusedClient.calls.some(({ sql }) => /INSERT INTO .*audio_business_analysis_jobs/.test(sql)),
      false,
    );

    const forcedClient = queueClient({ existing: { id: jobId, status: 'ready' } });
    const forcedRepository = new BusinessAnalysisRepository(
      { connect: async () => forcedClient.client },
      'echowave',
      tenantId,
    );
    const forced = await forcedRepository.queue(audioId, groupId, 'deepseek-v4-flash', true);
    assert.equal(forced.reused, false);
    const insert = forcedClient.calls.find(({ sql }) =>
      /INSERT INTO .*audio_business_analysis_jobs/.test(sql),
    );
    assert.equal(insert.values[5], 3);
    assert.deepEqual(insert.values[9], [knowledgeBaseId]);
    assert.equal(forcedClient.calls.at(-1).sql, 'COMMIT');
  });

  it('rejects audio without confirmed access through the requested group', async () => {
    const client = {
      query: async (sql) =>
        /SELECT af\.id AS audio_file_id/.test(sql) ? { rows: [] } : { rows: [] },
      release: () => {},
    };
    const repository = new BusinessAnalysisRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );
    await assert.rejects(
      () => repository.queue(audioId, groupId, 'deepseek-v4-flash'),
      (error) => error.code === 'CONFLICT' && /确认/.test(error.message),
    );
  });

  it('does not move the published head if the claimed job is no longer running', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/UPDATE .*audio_business_analysis_jobs/.test(sql)) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [] };
      },
      release: () => {},
    };
    const repository = new BusinessAnalysisRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );
    await assert.rejects(() =>
      repository.publish(
        {
          id: jobId,
          audioFileId: audioId,
          groupId,
          revisionId,
          confirmationId,
          confirmationVersion: 3,
          model: 'deepseek-v4-flash',
          knowledgeBaseIds: [],
          settings: {
            timing: 'manual',
            contentFocus: '关注异议处理',
            tone: '正式、专业',
            customTags: [],
            settingsUpdatedAt: null,
          },
          segments: [],
        },
        { limitations: [], summarySections: [], tags: [] },
        new Map(),
      ),
    );
    assert.equal(
      calls.some(({ sql }) => /INSERT INTO .*audio_group_business_analysis_heads/.test(sql)),
      false,
    );
    assert.equal(calls.at(-1).sql, 'ROLLBACK');
  });
});
