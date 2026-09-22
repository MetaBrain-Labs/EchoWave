/**
 * 重排披露聚合测试。
 *
 * 验证逐次检索审计折算为一份披露时的求和、状态优先级与脏数据容错。
 *
 * Responsibilities:
 * - 锁定"任一次降级即按降级披露"与降级时不得声称提升。
 * - 锁定旧审计只有 finalChunkIds 时仍能算出入选条数。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readRerankDisclosure } from '../../../dist/knowledge/retrieval/rerankDisclosure.js';

/** 构造一条已生效的检索审计。 */
function appliedAudit(overrides = {}) {
  return {
    rerankStatus: 'applied',
    rerankerModel: 'qwen3.7-text-rerank',
    candidateCount: 20,
    finalChunkIds: ['a', 'b', 'c'],
    rerankTokens: 12,
    rerankDurationMs: 380,
    fallbackReason: null,
    selectedCount: 3,
    promotedCount: 2,
    reordered: true,
    measured: true,
    ...overrides,
  };
}

describe('readRerankDisclosure', () => {
  it('sums counts across retrieval calls and keeps the applied status', () => {
    assert.deepEqual(readRerankDisclosure([appliedAudit(), appliedAudit({ candidateCount: 5 })]), {
      status: 'applied',
      model: 'qwen3.7-text-rerank',
      candidateCount: 25,
      selectedCount: 6,
      promotedCount: 4,
      reordered: true,
      measured: true,
      durationMs: 760,
      tokens: 24,
      fallbackReason: null,
    });
  });

  it('degrades the whole disclosure when any call fell back', () => {
    const disclosure = readRerankDisclosure([
      appliedAudit(),
      appliedAudit({
        rerankStatus: 'fallback',
        fallbackReason: 'MODEL_UNAVAILABLE',
        promotedCount: 2,
        reordered: true,
      }),
    ]);

    assert.equal(disclosure?.status, 'fallback');
    assert.equal(disclosure?.fallbackReason, 'MODEL_UNAVAILABLE');
    // 降级时入选集合仍是向量顺序，不能继续声称重排带来提升。
    assert.equal(disclosure?.promotedCount, 0);
    assert.equal(disclosure?.reordered, false);
  });

  it('reports applied without an effect claim when the audit predates the effect fields', () => {
    const disclosure = readRerankDisclosure([
      {
        ...appliedAudit(),
        selectedCount: undefined,
        promotedCount: undefined,
        reordered: undefined,
      },
    ]);

    assert.equal(disclosure?.selectedCount, 3);
    assert.equal(disclosure?.measured, false);
    assert.equal(disclosure?.promotedCount, 0);
    assert.equal(disclosure?.reordered, false);
  });

  it('ignores dirty entries and returns nothing when no entry mentions reranking', () => {
    assert.equal(readRerankDisclosure(undefined), undefined);
    assert.equal(readRerankDisclosure({}), undefined);
    assert.equal(readRerankDisclosure([null, 'x', { call: 1 }]), undefined);
    assert.equal(
      readRerankDisclosure([null, { call: 1 }, appliedAudit({ candidateCount: 'many' })])
        ?.candidateCount,
      0,
    );
  });

  it('reports disabled when every call ran without reranking', () => {
    const disclosure = readRerankDisclosure([
      appliedAudit({ rerankStatus: 'disabled', selectedCount: 2, finalChunkIds: ['a', 'b'] }),
    ]);

    assert.equal(disclosure?.status, 'disabled');
    assert.equal(disclosure?.selectedCount, 2);
    assert.equal(disclosure?.fallbackReason, null);
  });
});
