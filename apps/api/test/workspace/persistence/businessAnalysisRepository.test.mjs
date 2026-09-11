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

import { BUSINESS_ANALYSIS_MAX_LIMITATIONS } from '@echowave/contracts';

import { BusinessAnalysisRepository } from '../../../dist/workspace/audio/business-analysis/repository.js';

const tenantId = '00000000-0000-4000-8000-000000000001';
const groupId = '11111111-1111-4111-8111-111111111111';
const audioId = '22222222-2222-4222-8222-222222222222';
const revisionId = '33333333-3333-4333-8333-333333333333';
const confirmationId = '44444444-4444-4444-8444-444444444444';
const knowledgeBaseId = '55555555-5555-4555-8555-555555555555';
const jobId = '66666666-6666-4666-8666-666666666666';

function claimedJob() {
  return {
    id: jobId,
    audioFileId: audioId,
    groupId,
    revisionId,
    confirmationId,
    confirmationVersion: 3,
    model: 'deepseek-v4-flash',
    workflowVersion: 'langgraph-v1',
    recoveryAttempts: 0,
    knowledgeBaseIds: [],
    knowledgeBases: [],
    settings: {
      language: 'zh-CN',
      timing: 'manual',
      contentFocus: '关注异议处理',
      tone: '正式、专业',
      customTags: [],
      settingsUpdatedAt: null,
    },
    segments: [],
  };
}

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
  it('hydrates historical citation excerpts from current knowledge chunks', async () => {
    const tagId = '77777777-7777-4777-8777-777777777777';
    const chunkId = '88888888-8888-4888-8888-888888888888';
    const documentId = '99999999-9999-4999-8999-999999999999';
    const chunkContent = `  先确认客户顾虑。\n\n${'再提供可核实的业务证据。'.repeat(30)}  `;
    const pool = {
      query: async (sql) => {
        if (/SELECT af\.id AS audio_file_id/.test(sql)) return { rows: [snapshotRow()] };
        if (/SELECT gkb\.knowledge_base_id/.test(sql)) {
          return { rows: [{ knowledge_base_id: knowledgeBaseId }] };
        }
        if (/FROM .*audio_business_analysis_jobs.*ORDER BY created_at DESC/s.test(sql)) {
          return {
            rows: [
              {
                id: jobId,
                model: 'deepseek-v4-flash',
                status: 'ready',
                progress: 100,
                confirmation_version: 3,
                input_fingerprint: 'fingerprint',
              },
            ],
          };
        }
        if (/FROM .*audio_group_business_analysis_heads.*JOIN/s.test(sql)) {
          return {
            rows: [
              {
                id: jobId,
                model: 'deepseek-v4-flash',
                published_at: new Date('2026-08-28T08:00:00.000Z'),
                confirmation_version: 3,
                knowledge_base_ids: [knowledgeBaseId],
                settings_snapshot: {
                  timing: 'manual',
                  contentFocus: '关注异议处理',
                  tone: '正式、专业',
                  customTags: ['需求探索'],
                },
                limitations: Array.from(
                  { length: BUSINESS_ANALYSIS_MAX_LIMITATIONS + 1 },
                  (_, index) => `历史限制 ${index + 1}`,
                ),
              },
            ],
          };
        }
        if (/business_analysis_summary_sections/.test(sql)) return { rows: [] };
        if (/business_analysis_tags/.test(sql)) {
          return {
            rows: [
              {
                id: tagId,
                category: 'strength',
                custom_label: null,
                title: '异议处理',
                summary: '处理清晰',
                details: [],
                confidence: 90,
                segment_ids: [confirmationId],
              },
            ],
          };
        }
        if (/business_analysis_citations/.test(sql)) {
          assert.match(sql, /JOIN .*document_chunks/);
          return {
            rows: [
              {
                tag_id: tagId,
                chunk_id: chunkId,
                knowledge_base_id: knowledgeBaseId,
                document_id: documentId,
                document_title: '销售异议处理手册',
                content: chunkContent,
                locator: {
                  kind: 'markdown',
                  headingPath: ['异议处理'],
                  lineStart: 12,
                  lineEnd: 18,
                },
              },
            ],
          };
        }
        assert.fail(`unexpected SQL: ${sql}`);
      },
    };
    const repository = new BusinessAnalysisRepository(pool, 'echowave', tenantId);

    const state = await repository.getState(audioId, groupId);
    assert.equal(state.result.limitations.length, BUSINESS_ANALYSIS_MAX_LIMITATIONS);
    const excerpt = state.result.tags[0].citations[0].excerpt;
    assert.equal(excerpt.length, 240);
    assert.doesNotMatch(excerpt, /\s{2,}/);
    assert.match(excerpt, /^先确认客户顾虑。/);
  });

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
    assert.equal(insert.values[12], 'langgraph-v1');
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
        if (/SELECT job\.status, head\.active_job_id/.test(sql)) {
          return { rowCount: 1, rows: [{ status: 'failed', active_job_id: null }] };
        }
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
        claimedJob(),
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

  it('treats an already committed publication for the same head as success', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/SELECT job\.status, head\.active_job_id/.test(sql)) {
          return { rows: [{ status: 'ready', active_job_id: jobId }] };
        }
        return { rowCount: 1, rows: [] };
      },
      release: () => {},
    };
    const repository = new BusinessAnalysisRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );

    await repository.publish(
      claimedJob(),
      { limitations: [], summarySections: [{ title: '结论', body: '内容' }], tags: [] },
      new Map(),
    );

    assert.equal(
      calls.some(({ sql }) => /INSERT INTO .*business_analysis_summary_sections/.test(sql)),
      false,
    );
    assert.equal(
      calls.some(({ sql }) => /INSERT INTO .*audio_group_business_analysis_heads/.test(sql)),
      false,
    );
    assert.equal(calls.at(-1).sql, 'COMMIT');
  });

  it('persists bounded recovery backoff without resetting the workflow job', async () => {
    const calls = [];
    const repository = new BusinessAnalysisRepository(
      {
        query: async (sql, values) => {
          calls.push({ sql, values });
          return { rowCount: 1, rows: [] };
        },
      },
      'echowave',
      tenantId,
    );

    assert.equal(await repository.scheduleRecovery(jobId, 'UPSTREAM', 'temporary', 15_000), true);
    const scheduled = calls.at(-1);
    assert.match(scheduled.sql, /recovery_attempts = recovery_attempts \+ 1/);
    assert.match(scheduled.sql, /recovery_attempts < \$6/);
    assert.equal(scheduled.values[2], 15_000);
    assert.equal(scheduled.values[5], 2);
  });

  it('requeues interrupted work without consuming recovery attempts or losing progress', async () => {
    const calls = [];
    const repository = new BusinessAnalysisRepository(
      {
        query: async (sql, values) => {
          calls.push({ sql, values });
          return { rowCount: 1, rows: [] };
        },
      },
      'echowave',
      tenantId,
    );

    await repository.resetInterrupted();
    const reset = calls.at(-1);
    assert.match(reset.sql, /status = 'queued'/);
    assert.match(reset.sql, /next_attempt_at = now\(\)/);
    assert.doesNotMatch(reset.sql, /recovery_attempts\s*=/);
    assert.doesNotMatch(reset.sql, /progress\s*=/);
  });
});
