/**
 * 重排效果差异测试。
 *
 * 验证"重排提升"只统计重排后新进入入选集合的证据，且未生效时始终为零。
 *
 * Responsibilities:
 * - 锁定集合变化与顺序变化的区分。
 * - 锁定降级/关闭时不把向量顺序计入重排成果。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rerankSelectionDelta } from '../../../dist/knowledge/retrieval/postgresKnowledgeSearch.js';

describe('rerankSelectionDelta', () => {
  it('reports no change when reranking keeps the vector order', () => {
    assert.deepEqual(rerankSelectionDelta(['a', 'b', 'c'], ['a', 'b', 'c'], true), {
      promotedCount: 0,
      reordered: false,
    });
  });

  it('separates a pure reorder from newly promoted evidence', () => {
    assert.deepEqual(rerankSelectionDelta(['a', 'b', 'c'], ['c', 'b', 'a'], true), {
      promotedCount: 0,
      reordered: true,
    });
    assert.deepEqual(rerankSelectionDelta(['a', 'b', 'c'], ['d', 'c', 'b'], true), {
      promotedCount: 1,
      reordered: true,
    });
  });

  it('never claims a rerank effect when reranking did not apply', () => {
    assert.deepEqual(rerankSelectionDelta(['a', 'b', 'c'], ['d', 'c', 'b'], false), {
      promotedCount: 0,
      reordered: false,
    });
  });
});
