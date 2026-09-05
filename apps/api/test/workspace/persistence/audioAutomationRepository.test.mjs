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
const taskId = '77777777-7777-4777-8777-777777777777';

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

describe('AudioAutomationRepository.createBatch', () => {
  it('derives acoustic emotion readiness for existing hybrid audio instead of reading a column', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/SELECT ds\.id AS data_source_id/.test(sql)) {
          return {
            rows: [
              {
                data_source_id: dataSourceId,
                group_id: groupId,
                group_name: '销售组',
                analysis_timing: 'manual',
                content_focus: '分析销售表现',
                tone: '专业',
                custom_tags: [],
                knowledge_base_ids: [],
              },
            ],
          };
        }
        if (/INSERT INTO .*audio_analysis_batches/.test(sql)) return { rows: [{ id: batchId }] };
        if (/FROM .*audio_files.*af/s.test(sql)) {
          return {
            rowCount: 1,
            rows: [
              {
                id: audioFileId,
                title: '客户访谈',
                runtime_mode: 'hybrid',
                source_state: 'available',
                source_recovery_state: 'not_required',
                acoustic_emotion_ready: false,
              },
            ],
          };
        }
        if (/INSERT INTO .*audio_analysis_tasks/.test(sql)) return { rows: [{ id: taskId }] };
        return { rows: [] };
      },
      release: () => {},
    };
    const repository = new AudioAutomationRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );

    const result = await repository.createBatch(
      {
        source: 'existing_audio',
        dataSourceId,
        groupId,
        audioFileIds: [audioFileId],
        scheduledFor: null,
        pipeline: {
          confirmation: 'system_raw_snapshot',
          includeEmotion: true,
          includeRole: true,
          includeBusinessAnalysis: true,
          transcriptPolicy: 'reuse_or_create',
        },
      },
      {
        capabilityBindings: configurationSnapshot.capabilityBindings,
        models: configurationSnapshot.models,
      },
      'hybrid',
    );

    const assetQuery = calls.find((call) => /FROM .*audio_files.*af/s.test(call.sql));
    assert.deepEqual(result.tasks, [{ id: taskId, clientItemId: null, audioFileId }]);
    assert.match(assetQuery.sql, /coalesce\(latest\.acoustic_emotion_ready, false\)/);
    assert.match(assetQuery.sql, /active_emotion\.status = 'ready'/);
    assert.match(assetQuery.sql, /bundled\.status = 'ready'/);
    assert.equal(calls.at(-1).sql, 'COMMIT');
  });
});

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

describe('AudioAutomationRepository.cancelTask', () => {
  it('does not update a nonexistent updated_at column on business jobs', async () => {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(sql);
        if (/UPDATE .*audio_analysis_tasks[\s\S]*RETURNING id, batch_id/.test(sql)) {
          return { rows: [{ id: taskId, batch_id: batchId }] };
        }
        if (/SELECT batch_id FROM/.test(sql)) {
          return { rows: [{ batch_id: batchId }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };
    const repository = new AudioAutomationRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );

    await repository.cancelTask(taskId);

    const runningBusinessUpdate = calls.find(
      (sql) => /UPDATE .*audio_business_analysis_jobs/.test(sql) && /status = 'running'/.test(sql),
    );
    assert.ok(runningBusinessUpdate);
    assert.doesNotMatch(runningBusinessUpdate, /updated_at\s*=/i);
  });
});
