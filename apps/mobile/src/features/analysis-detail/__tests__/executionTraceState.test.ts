/**
 * 音频执行轨迹实时状态测试。
 *
 * 验证终态归并、revision 隔离和无法应用事件的拒绝语义。
 *
 * Responsibilities:
 * - 防止缺少目标的 SSE 事件被误认为已消费。
 * - 锁定运行中记录的快照校正判定。
 *
 * Notes:
 * - 测试纯状态转换，不建立网络连接。
 */
import type { AudioAiExecutionRun, AudioAiExecutionTraceResponse } from '@echowave/contracts';

import { applyExecutionTraceEvent, hasRunningExecution } from '../executionTraceState';

const audioFileId = '10000000-0000-4000-8000-000000000001';
const revisionId = '20000000-0000-4000-8000-000000000001';
const runId = '30000000-0000-4000-8000-000000000001';
const operationId = '40000000-0000-4000-8000-000000000001';

type ModelCall = AudioAiExecutionRun['modelCalls'][number];

const runningCall: ModelCall = {
  id: operationId,
  sequence: 2,
  operation: 'business-analysis-generation',
  name: '结合转写与知识证据生成业务分析',
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  status: 'running',
  attempt: 1,
  startedAt: '2026-09-01T16:12:35.960Z',
  completedAt: null,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  reasoningMode: 'streaming',
  reasoningContent: '',
  reasoningTruncated: false,
  estimatedCost: null,
};

const trace: AudioAiExecutionTraceResponse = {
  audioFileId,
  analysisRevisionId: revisionId,
  runs: [
    {
      id: runId,
      kind: 'audio-business-analysis',
      name: 'EchoWave sales conversation review',
      phase: null,
      status: 'running',
      groupId: null,
      sourceJobId: null,
      startedAt: '2026-09-01T16:12:29.683Z',
      completedAt: null,
      durationMs: null,
      error: null,
      steps: [],
      modelCalls: [runningCall],
      toolCalls: [],
    },
  ],
};

describe('executionTraceState', () => {
  it('applies the persisted model terminal state and clears the running marker', () => {
    const completedCall: ModelCall = {
      ...runningCall,
      status: 'completed',
      completedAt: '2026-09-01T16:13:32.855Z',
      durationMs: 56_895,
    };
    const next = applyExecutionTraceEvent(trace, {
      type: 'model-finish',
      cursor: '12',
      audioFileId,
      analysisRevisionId: revisionId,
      runId,
      operationId,
      modelCall: completedCall,
    });

    expect(next?.runs[0]?.modelCalls[0]).toEqual(completedCall);
    expect(next?.runs[0]?.modelCalls[0]?.status).toBe('completed');
    expect(hasRunningExecution(trace)).toBe(true);
  });

  it('rejects an event when its operation or revision cannot be found', () => {
    expect(
      applyExecutionTraceEvent(trace, {
        type: 'reasoning-delta',
        cursor: '13',
        audioFileId,
        analysisRevisionId: revisionId,
        runId,
        operationId: '50000000-0000-4000-8000-000000000001',
        delta: '不可丢失的增量',
        truncated: false,
      }),
    ).toBeUndefined();
    expect(
      applyExecutionTraceEvent(trace, {
        type: 'model-finish',
        cursor: '14',
        audioFileId,
        analysisRevisionId: '60000000-0000-4000-8000-000000000001',
        runId,
        operationId,
        modelCall: runningCall,
      }),
    ).toBeUndefined();
  });
});
