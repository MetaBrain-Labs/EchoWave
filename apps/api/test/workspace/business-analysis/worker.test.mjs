/**
 * 分组销售复盘 Worker 测试。
 *
 * 验证任务成功收口、有限持久恢复、终态失败和 checkpoint 清理边界。
 *
 * Responsibilities:
 * - 锁定 15/60 秒恢复预算与终态清理行为。
 * - 验证每次恢复尝试生成独立安全执行报告。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BusinessAnalysisProviderError } from '../../../dist/workspace/audio/business-analysis/salesAnalysisAgent.js';
import {
  BusinessAnalysisWorker,
  buildBusinessRetrievalQueries,
} from '../../../dist/workspace/audio/business-analysis/worker.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const audioId = '22222222-2222-4222-8222-222222222222';
const revisionId = '33333333-3333-4333-8333-333333333333';
const confirmationId = '44444444-4444-4444-8444-444444444444';
const jobId = '55555555-5555-4555-8555-555555555555';
const segmentId = '66666666-6666-4666-8666-666666666666';

function makeJob(overrides = {}) {
  return {
    id: jobId,
    audioFileId: audioId,
    groupId,
    revisionId,
    confirmationId,
    confirmationVersion: 1,
    model: 'deepseek-v4-flash',
    workflowVersion: 'langgraph-v1',
    recoveryAttempts: 0,
    knowledgeBaseIds: [],
    knowledgeBases: [],
    settings: {
      language: 'zh-CN',
      timing: 'manual',
      contentFocus: '分析销售话术',
      tone: '正式、专业',
      customTags: [],
      settingsUpdatedAt: null,
    },
    segments: [
      {
        id: segmentId,
        speakerKey: 'Speaker 0',
        speakerLabel: '销售',
        startMs: 0,
        endMs: 1_000,
        text: '我们可以先确认你的核心顾虑。',
        role: null,
        emotion: null,
      },
    ],
    ...overrides,
  };
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function reporter(records) {
  return {
    start: (input) => {
      const record = { input, metadata: undefined, outputs: [], steps: [], finish: undefined };
      records.push(record);
      return {
        recordMetadata: (value) => (record.metadata = value),
        recordStep: (value) => record.steps.push(value),
        recordModelCall: () => {},
        recordToolCall: () => {},
        recordContext: () => {},
        recordReasoning: () => {},
        recordOutput: (value) => record.outputs.push(value),
        finish: async (value) => {
          record.finish = value;
        },
      };
    },
  };
}

function repositoryFor(job, overrides = {}) {
  let claimed = false;
  return {
    resetInterrupted: async () => {},
    listCheckpointCleanupCandidates: async () => [],
    markCheckpointCleaned: async () => {},
    claim: async () => {
      if (claimed) return undefined;
      claimed = true;
      return job;
    },
    scheduleRecovery: async () => false,
    fail: async () => {},
    ...overrides,
  };
}

describe('BusinessAnalysisWorker', () => {
  it('builds no more than three bounded proactive retrieval queries', () => {
    const queries = buildBusinessRetrievalQueries(
      '关注销售表现',
      Array.from({ length: 20 }, (_, index) => ({ text: `片段${index}${'内容'.repeat(300)}` })),
    );
    assert.equal(queries.length, 3);
    assert.ok(queries.every((query) => query.length <= 3_110));
  });

  it('finishes a successful workflow attempt and cleans its checkpoint', async () => {
    const records = [];
    const cleaned = [];
    const repository = repositoryFor(makeJob(), {
      markCheckpointCleaned: async (id) => cleaned.push(id),
    });
    const workflow = {
      run: async () => ({
        publication: { limitations: [], summarySections: [], tags: [] },
        retrievedChunks: [],
        resumed: true,
      }),
      deleteCheckpoint: async (job) => cleaned.push(`thread:${job.id}`),
    };
    const worker = new BusinessAnalysisWorker({
      repository,
      workflow,
      reporter: reporter(records),
    });

    await worker.start();
    await waitUntil(() => records[0]?.finish);
    await worker.stop();

    assert.equal(records[0].finish.status, 'completed');
    assert.equal(records[0].finish.metadata.resumedFromCheckpoint, true);
    assert.deepEqual(cleaned, [`thread:${jobId}`, jobId]);
  });

  it('schedules the first retryable failure after 15 seconds without deleting checkpoint', async () => {
    const records = [];
    const scheduled = [];
    let failed = false;
    let deleted = false;
    const repository = repositoryFor(makeJob(), {
      scheduleRecovery: async (...args) => {
        scheduled.push(args);
        return true;
      },
      fail: async () => {
        failed = true;
      },
    });
    const workflow = {
      run: async () => {
        throw new BusinessAnalysisProviderError('MODEL_TIMEOUT', '模型超时。', true);
      },
      deleteCheckpoint: async () => {
        deleted = true;
      },
    };
    const worker = new BusinessAnalysisWorker({
      repository,
      workflow,
      reporter: reporter(records),
    });

    await worker.start();
    await waitUntil(() => records[0]?.finish);
    await worker.stop();

    assert.equal(scheduled.length, 1);
    assert.deepEqual(scheduled[0].slice(0, 4), [jobId, 'MODEL_TIMEOUT', '模型超时。', 15_000]);
    assert.equal(records[0].finish.metadata.willRetry, true);
    assert.deepEqual(records[0].steps.at(-1), {
      name: 'workflow-recovery-decision',
      status: 'completed',
      metadata: {
        recoveryAttempt: 0,
        nextRecoveryAttempt: 1,
        willRetry: true,
        retryable: true,
      },
    });
    assert.equal(failed, false);
    assert.equal(deleted, false);
  });

  it('uses the second 60-second delay and fails terminally after the recovery budget', async () => {
    const delays = [];
    for (const [recoveryAttempts, expectedDelay] of [
      [1, 60_000],
      [2, null],
    ]) {
      const records = [];
      let failed = false;
      let cleaned = false;
      const repository = repositoryFor(makeJob({ recoveryAttempts }), {
        scheduleRecovery: async (_id, _code, _message, delay) => {
          delays.push(delay);
          return true;
        },
        fail: async () => {
          failed = true;
        },
        markCheckpointCleaned: async () => {
          cleaned = true;
        },
      });
      const workflow = {
        run: async () => {
          throw new BusinessAnalysisProviderError('MODEL_UNAVAILABLE', '服务不可用。', true);
        },
        deleteCheckpoint: async () => {},
      };
      const worker = new BusinessAnalysisWorker({
        repository,
        workflow,
        reporter: reporter(records),
      });
      await worker.start();
      await waitUntil(() => records[0]?.finish);
      await worker.stop();
      assert.equal(failed, recoveryAttempts === 2);
      assert.equal(cleaned, recoveryAttempts === 2);
      assert.equal(records[0].finish.metadata.willRetry, recoveryAttempts === 1);
      if (expectedDelay !== null) assert.equal(delays.at(-1), expectedDelay);
    }
  });

  it('fails a non-retryable error immediately and removes its checkpoint', async () => {
    const records = [];
    let scheduled = false;
    let failed;
    let cleaned = false;
    const repository = repositoryFor(makeJob(), {
      scheduleRecovery: async () => {
        scheduled = true;
        return true;
      },
      fail: async (...args) => {
        failed = args;
      },
      markCheckpointCleaned: async () => {
        cleaned = true;
      },
    });
    const workflow = {
      run: async () => {
        throw new BusinessAnalysisProviderError(
          'INVALID_MODEL_OUTPUT',
          '确认转写中没有可分析的正文。',
          false,
        );
      },
      deleteCheckpoint: async () => {},
    };
    const worker = new BusinessAnalysisWorker({
      repository,
      workflow,
      reporter: reporter(records),
    });

    await worker.start();
    await waitUntil(() => records[0]?.finish);
    await worker.stop();

    assert.equal(scheduled, false);
    assert.deepEqual(failed, [
      jobId,
      'INVALID_MODEL_OUTPUT',
      '确认转写中没有可分析的正文。',
      false,
    ]);
    assert.equal(cleaned, true);
    assert.equal(records[0].finish.metadata.willRetry, false);
  });

  it('cleans terminal checkpoint candidates during startup without blocking claims', async () => {
    const cleaned = [];
    const repository = repositoryFor(undefined, {
      listCheckpointCleanupCandidates: async () => [{ id: jobId, workflowVersion: 'langgraph-v1' }],
      markCheckpointCleaned: async (id) => cleaned.push(`marked:${id}`),
    });
    const workflow = {
      run: async () => assert.fail('no job should run'),
      deleteCheckpoint: async (job) => cleaned.push(`deleted:${job.id}`),
    };
    const worker = new BusinessAnalysisWorker({ repository, workflow });
    await worker.start();
    await worker.stop();
    assert.deepEqual(cleaned, [`deleted:${jobId}`, `marked:${jobId}`]);
  });
});
