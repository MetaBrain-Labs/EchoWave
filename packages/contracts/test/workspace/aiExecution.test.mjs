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

import { AudioAiExecutionTraceResponseSchema } from '@echowave/contracts';

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
        modelCalls: [],
        toolCalls: [
          {
            sequence: 1,
            name: 'search_knowledge',
            status: 'completed',
            occurredAt: '2026-08-29T01:00:01.000Z',
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
  it('accepts safe model and retrieval summaries', () => {
    assert.equal(AudioAiExecutionTraceResponseSchema.parse(trace()).runs.length, 1);
  });

  it('rejects oversized retrieval queries', () => {
    const value = trace();
    value.runs[0].toolCalls[0].query = 'x'.repeat(4_001);
    assert.throws(() => AudioAiExecutionTraceResponseSchema.parse(value));
  });
});
