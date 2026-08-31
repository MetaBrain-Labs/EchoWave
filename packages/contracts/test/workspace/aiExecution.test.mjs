/**
 * 音频 AI 执行轨迹契约测试。
 *
 * 验证模型、步骤与知识检索摘要可被安全解析并拒绝越界查询。
 *
 * Responsibilities:
 * - 锁定 API 与移动端共享的模型详情边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AudioAiExecutionStepSchema,
  AudioAiExecutionStreamEventSchema,
  AudioAiExecutionTraceResponseSchema,
} from '@echowave/contracts';

const id = '10000000-0000-4000-8000-000000000001';
const secondId = '20000000-0000-4000-8000-000000000002';

function trace() {
  return {
    audioFileId: id,
    analysisRevisionId: secondId,
    runs: [
      {
        id,
        kind: 'audio-business-analysis',
        name: 'sales review',
        phase: null,
        status: 'completed',
        groupId: secondId,
        sourceJobId: id,
        startedAt: '2026-08-29T01:00:00.000Z',
        completedAt: '2026-08-29T01:00:02.000Z',
        durationMs: 2_000,
        error: null,
        steps: [],
        modelCalls: [
          {
            id,
            sequence: 1,
            operation: 'business-analysis-generation',
            name: '结合转写与知识证据生成业务分析',
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            status: 'running',
            attempt: 1,
            startedAt: '2026-08-29T01:00:00.500Z',
            completedAt: null,
            durationMs: null,
            inputTokens: null,
            outputTokens: null,
            reasoningMode: 'streaming',
            reasoningContent: '正在核对转写与证据。',
            reasoningTruncated: false,
            estimatedCost: null,
          },
        ],
        toolCalls: [
          {
            id: secondId,
            sequence: 2,
            operation: 'search_knowledge',
            name: '检索分组关联知识库',
            status: 'completed',
            startedAt: '2026-08-29T01:00:01.000Z',
            completedAt: '2026-08-29T01:00:01.050Z',
            durationMs: 50,
            query: '客户异议处理',
            knowledgeBases: [{ id, name: '销售知识库' }],
            hitCount: 1,
            hits: [
              {
                chunkId: id,
                knowledgeBaseId: id,
                documentId: secondId,
                documentTitle: '销售手册',
                locator: { kind: 'markdown', headingPath: ['异议'], lineStart: 2, lineEnd: 8 },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('audio AI execution trace contract', () => {
  it('keeps running step durations empty and terminal durations concrete', () => {
    const base = {
      id,
      sequence: 1,
      name: 'analysis-generation',
      occurredAt: '2026-08-29T01:00:00.000Z',
      summary: {},
    };

    assert.equal(
      AudioAiExecutionStepSchema.parse({ ...base, status: 'started', durationMs: null }).durationMs,
      null,
    );
    assert.equal(
      AudioAiExecutionStepSchema.parse({ ...base, status: 'completed', durationMs: 12 }).durationMs,
      12,
    );
    assert.throws(() =>
      AudioAiExecutionStepSchema.parse({ ...base, status: 'completed', durationMs: null }),
    );
  });
  it('accepts safe model and retrieval summaries', () => {
    assert.equal(AudioAiExecutionTraceResponseSchema.parse(trace()).runs.length, 1);
  });

  it('rejects oversized retrieval queries', () => {
    const value = trace();
    value.runs[0].toolCalls[0].query = 'x'.repeat(4_001);
    assert.throws(() => AudioAiExecutionTraceResponseSchema.parse(value));
  });

  it('accepts resumable snapshots and bounded reasoning deltas', () => {
    assert.equal(
      AudioAiExecutionStreamEventSchema.parse({
        type: 'snapshot',
        cursor: '17',
        audioFileId: id,
        analysisRevisionId: secondId,
        trace: trace(),
      }).type,
      'snapshot',
    );
    assert.equal(
      AudioAiExecutionStreamEventSchema.parse({
        type: 'reasoning-delta',
        cursor: '18',
        audioFileId: id,
        analysisRevisionId: secondId,
        runId: id,
        operationId: secondId,
        delta: '核对知识证据',
        truncated: false,
      }).cursor,
      '18',
    );
    assert.throws(() =>
      AudioAiExecutionStreamEventSchema.parse({
        type: 'reasoning-delta',
        cursor: '19',
        audioFileId: id,
        analysisRevisionId: secondId,
        runId: id,
        operationId: secondId,
        delta: 'x'.repeat(2_049),
        truncated: false,
      }),
    );
  });
});
