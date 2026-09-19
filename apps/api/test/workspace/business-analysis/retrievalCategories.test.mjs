/**
 * 报告头部知识库分类摘要测试。
 *
 * 覆盖去重、命中累加、原因优先级与脏审计条目容错。
 *
 * Notes:
 * - 只验证纯合并逻辑，不连接数据库。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aggregateRetrievalCategories } from '../../../dist/workspace/audio/business-analysis/retrievalCategories.js';

function auditEntry(overrides = {}) {
  return {
    call: 1,
    query: '客户异议如何处理',
    knowledgeBaseIds: ['kb-1'],
    categoryIds: ['c1'],
    categories: [{ id: 'c1', name: '产品资料' }],
    includeTestSamples: false,
    reason: 'auto',
    hitCount: 4,
    durationMs: 120,
    ...overrides,
  };
}

describe('aggregateRetrievalCategories', () => {
  it('deduplicates a category across calls and sums its hits', () => {
    const summary = aggregateRetrievalCategories([
      auditEntry({ call: 1, hitCount: 4 }),
      auditEntry({ call: 2, hitCount: 3, categories: [{ id: 'c1', name: '产品资料' }] }),
    ]);

    assert.deepEqual(summary, [{ id: 'c1', name: '产品资料', lookupReason: 'auto', hitCount: 7 }]);
  });

  it('keeps the most specific reason when a category is searched more than once', () => {
    const summary = aggregateRetrievalCategories([
      auditEntry({ call: 1, reason: 'zero-hits', hitCount: 0 }),
      auditEntry({ call: 2, reason: 'explicit', hitCount: 2 }),
    ]);

    // explicit 比 zero-hits 更能解释用户限定的检索范围。
    assert.equal(summary[0].lookupReason, 'explicit');
    assert.equal(summary[0].hitCount, 2);
  });

  it('preserves the frozen name verbatim instead of resolving it again', () => {
    const summary = aggregateRetrievalCategories([
      auditEntry({ categories: [{ id: 'c1', name: '旧分类名' }] }),
    ]);

    assert.equal(summary[0].name, '旧分类名');
  });

  it('drops malformed audit entries without failing the whole summary', () => {
    const summary = aggregateRetrievalCategories([
      null,
      'not-an-entry',
      auditEntry({ reason: 'unknown-reason' }),
      auditEntry({ categories: 'not-an-array' }),
      auditEntry({ categories: [{ id: 'c1' }, { name: '缺少 ID' }, { id: 'c2', name: '' }] }),
      auditEntry({ categories: [{ id: 'c3', name: '话术案例' }], hitCount: 2 }),
    ]);

    assert.deepEqual(summary, [{ id: 'c3', name: '话术案例', lookupReason: 'auto', hitCount: 2 }]);
  });

  it('returns an empty summary for reports without retrieval audit', () => {
    assert.deepEqual(aggregateRetrievalCategories([]), []);
    assert.deepEqual(aggregateRetrievalCategories(null), []);
    assert.deepEqual(aggregateRetrievalCategories(undefined), []);
  });
});
