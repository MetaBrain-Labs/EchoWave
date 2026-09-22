/**
 * 问答历史仓储测试。
 *
 * 验证最近问答查询始终限定租户、知识库、完成状态和六条上限，并从运行审计带出重排披露。
 *
 * Responsibilities:
 * - 锁定历史列表 SQL 的隔离与排序约束。
 * - 锁定旧运行缺少重排审计时不输出该字段。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConversationRepository } from '../../../dist/knowledge/persistence/conversationRepository.js';

describe('ConversationRepository history', () => {
  it('returns only the six newest completed runs in the requested scope', async () => {
    const calls = [];
    const pool = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              conversation_id: '22222222-2222-4222-8222-222222222222',
              question: '问题',
              answer: '回答',
              grounded: true,
              citation_count: 2,
              created_at: new Date('2026-08-20T12:00:00.000Z'),
            },
          ],
        };
      },
    };
    const repository = new ConversationRepository(
      pool,
      'echowave',
      '33333333-3333-4333-8333-333333333333',
    );

    const result = await repository.listRecentRuns('44444444-4444-4444-8444-444444444444');

    assert.equal(result.items[0].citationCount, 2);
    assert.match(calls[0].sql, /status = 'completed'/);
    assert.match(calls[0].sql, /ORDER BY created_at DESC/);
    assert.match(calls[0].sql, /LIMIT 6/);
    assert.deepEqual(calls[0].values, [
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ]);
  });

  it('carries the rerank disclosure out of the stored retrieval audit', async () => {
    const pool = {
      query: async () => ({
        rows: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            conversation_id: '22222222-2222-4222-8222-222222222222',
            question: '问题',
            answer: '回答',
            grounded: true,
            citation_count: 1,
            created_at: new Date('2026-08-20T12:00:00.000Z'),
            retrieval_audit: [
              {
                rerankStatus: 'applied',
                rerankerModel: 'qwen3.7-text-rerank',
                candidateCount: 20,
                finalChunkIds: ['a', 'b', 'c'],
                rerankTokens: 12,
                rerankDurationMs: 380,
                selectedCount: 3,
                promotedCount: 2,
                reordered: true,
              },
            ],
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            conversation_id: '22222222-2222-4222-8222-222222222222',
            question: '旧问题',
            answer: '旧回答',
            grounded: true,
            citation_count: 0,
            created_at: new Date('2026-08-19T12:00:00.000Z'),
          },
        ],
      }),
    };
    const repository = new ConversationRepository(
      pool,
      'echowave',
      '33333333-3333-4333-8333-333333333333',
    );

    const result = await repository.listRecentRuns('44444444-4444-4444-8444-444444444444');

    assert.deepEqual(result.items[0]?.rerank, {
      status: 'applied',
      model: 'qwen3.7-text-rerank',
      candidateCount: 20,
      selectedCount: 3,
      promotedCount: 2,
      reordered: true,
      measured: true,
      durationMs: 380,
      tokens: 12,
      fallbackReason: null,
    });
    // 旧运行没有重排审计：字段缺失，客户端据此不渲染。
    assert.equal(result.items[1]?.rerank, undefined);
  });
});
