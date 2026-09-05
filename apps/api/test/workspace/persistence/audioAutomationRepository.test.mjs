/**
 * 自动分析批次报告归属测试。
 *
 * 锁定终态过滤和业务任务、音频、分组之间的报告引用关系，避免失败或取消任务复用旧报告。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioAutomationRepository } from '../../../dist/workspace/audio/automation/repository.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';
const dataSourceId = '33333333-3333-4333-8333-333333333333';
const groupId = '44444444-4444-4444-8444-444444444444';
const audioFileId = '55555555-5555-4555-8555-555555555555';
const businessJobId = '66666666-6666-4666-8666-666666666666';

const configurationSnapshot = {
  groupName: '销售组',
  analysisTiming: 'automatic',
  contentFocus: '分析销售表现',
  tone: '专业',
  customTags: [],
  knowledgeBaseIds: [],
  capabilityBindings: {
    transcription: null,
    staging: null,
    emotion: null,
    role: null,
    businessAnalysis: null,
    knowledgeEmbedding: null,
  },
  models: {
    transcription: null,
    emotion: null,
    role: null,
    businessAnalysis: null,
  },
};

function createRepository(task = {}) {
  const calls = [];
  const pool = {
    query: async (sql) => {
      calls.push(sql);
      if (calls.length === 1) {
        return {
          rows: [
            {
              id: batchId,
              data_source_id: dataSourceId,
              group_id: groupId,
              source_kind: 'existing_audio',
              scheduled_for: null,
              configuration_snapshot: configurationSnapshot,
              created_at: '2026-09-04T00:00:00.000Z',
            },
          ],
        };
      }
      return {
        rows: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            batch_id: batchId,
            audio_file_id: audioFileId,
            title: '客户访谈',
            runtime_mode: 'object_storage',
            status: 'completed',
            phase: 'done',
            progress: 100,
            run_after: null,
            warning_codes: [],
            blocker_reason: null,
            blocker_capability: null,
            blocker_message: null,
            source_expires_at: null,
            error_code: null,
            error_message: null,
            error_retryable: null,
            business_job_id: businessJobId,
            business_status: 'ready',
            business_group_id: groupId,
            business_audio_file_id: audioFileId,
            business_head_job_id: businessJobId,
            created_at: '2026-09-04T00:00:00.000Z',
            updated_at: '2026-09-04T00:00:00.000Z',
            ...task,
          },
        ],
      };
    },
  };
  return {
    repository: new AudioAutomationRepository(pool, 'echowave', tenantId),
    calls,
  };
}

describe('AudioAutomationRepository.getBatch', () => {
  it('only exposes a report for a completed task with matching business ownership', async () => {
    const { repository, calls } = createRepository();

    const result = await repository.getBatch(batchId);

    assert.equal(result.tasks[0].reportAvailable, true);
    assert.deepEqual(result.tasks[0].report, { audioFileId, groupId });
    assert.match(calls[1], /business\.group_id = \$3/);
    assert.match(calls[1], /business\.audio_file_id = task\.audio_file_id/);
  });

  it('hides old reports for failed and canceled tasks', async () => {
    for (const status of ['failed', 'canceled']) {
      const { repository } = createRepository({ status, phase: 'done', progress: 80 });

      const result = await repository.getBatch(batchId);

      assert.equal(result.tasks[0].reportAvailable, false, status);
      assert.equal(result.tasks[0].report, null, status);
    }
  });

  it('rejects a report when the business job points to another group or audio file', async () => {
    for (const mismatch of [
      { business_group_id: '88888888-8888-4888-8888-888888888888' },
      { business_audio_file_id: '99999999-9999-4999-8999-999999999999' },
      { business_head_job_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    ]) {
      const { repository } = createRepository(mismatch);

      const result = await repository.getBatch(batchId);

      assert.equal(result.tasks[0].reportAvailable, false);
      assert.equal(result.tasks[0].report, null);
    }
  });
});
