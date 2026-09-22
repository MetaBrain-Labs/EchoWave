/**
 * 音频执行轨迹映射测试。
 *
 * 验证重排模型调用从持久化事件恢复为中文名称与量化审计。
 *
 * Responsibilities:
 * - 锁定重排披露字段从 details 的容错读取。
 * - 锁定旧事件没有重排审计时不输出该字段。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioExecutionEventMapper } from '../../dist/workspace/audio/execution/eventMapping.js';

const runId = '11111111-1111-4111-8111-111111111111';

/** 构造一条重排模型调用事件对。 */
function rerankEvents(details) {
  const base = {
    execution_run_id: runId,
    operation_id: '22222222-2222-4222-8222-222222222222',
    event_type: 'model_call',
    name: 'knowledge-rerank',
    occurred_at: new Date('2026-09-03T08:00:00.000Z'),
    duration_ms: 300,
    details: {},
  };
  return [
    { ...base, sequence_no: 1, stream_cursor: 1, status: 'started' },
    {
      ...base,
      sequence_no: 2,
      stream_cursor: 2,
      status: 'completed',
      details: {
        displayName: '知识重排候选',
        provider: 'dashscope',
        model: 'qwen3.7-text-rerank',
        attempt: 1,
        inputTokens: 9,
        outputTokens: 0,
        ...details,
      },
    },
  ];
}

/** 构造一条最小可映射的运行行。 */
function runRow() {
  return {
    id: runId,
    kind: 'audio-business-analysis',
    name: '业务分析',
    phase: null,
    status: 'completed',
    group_id: null,
    source_job_id: null,
    started_at: new Date('2026-09-03T08:00:00.000Z'),
    completed_at: new Date('2026-09-03T08:00:10.000Z'),
    duration_ms: 10_000,
    error_code: null,
    error_message: null,
    error_retryable: null,
  };
}

describe('AudioExecutionEventMapper rerank disclosure', () => {
  it('restores the Chinese name and the stored rerank audit', () => {
    const mapped = new AudioExecutionEventMapper().mapRun(
      runRow(),
      rerankEvents({
        rerank: {
          status: 'applied',
          model: 'qwen3.7-text-rerank',
          candidateCount: 20,
          selectedCount: 5,
          promotedCount: 2,
          reordered: true,
          durationMs: 300,
          tokens: 9,
          fallbackReason: null,
        },
      }),
    );

    const call = mapped.modelCalls[0];
    assert.equal(call.name, '知识重排候选');
    assert.equal(call.rerank?.status, 'applied');
    assert.equal(call.rerank?.candidateCount, 20);
    assert.equal(call.rerank?.promotedCount, 2);
  });

  it('leaves the field out for events written before the audit existed', () => {
    const mapped = new AudioExecutionEventMapper().mapRun(runRow(), rerankEvents({}));

    assert.equal(mapped.modelCalls[0].rerank, undefined);
  });

  it('ignores a rerank payload that carries no usable status', () => {
    const mapped = new AudioExecutionEventMapper().mapRun(
      runRow(),
      rerankEvents({ rerank: { candidateCount: 20 } }),
    );

    assert.equal(mapped.modelCalls[0].rerank, undefined);
  });
});
