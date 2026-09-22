/** 类别路由、模型建议、实际 SQL 范围与入库失败兼容回归。 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  CategoryRetrievalPolicy,
  isTestSampleQuestion,
} from '../../../dist/knowledge/retrieval/categoryPolicy.js';
import {
  buildClassificationSample,
  validateClassificationSuggestion,
  KnowledgeClassifier,
} from '../../../dist/knowledge/categories/classifier.js';
import { PostgresKnowledgeSearch } from '../../../dist/knowledge/retrieval/postgresKnowledgeSearch.js';
import { createIngestionNodes } from '../../../dist/knowledge/ingestion/graph/nodes.js';
import { noOpAiExecutionRecorder } from '../../../dist/ai-observability/executionReporter.js';
const ids = Array.from({ length: 4 }, (_, index) => `11111111-1111-4111-8111-11111111111${index}`);
const catalogue = ['general', 'product', 'test', 'sop'].map((key, index) => ({
  id: ids[index],
  key,
  name: key,
  description: key,
  active: true,
  version: 0,
}));
it('routes to bounded categories and shares one fallback for zero hits and insufficient evidence', () => {
  const policy = new CategoryRetrievalPolicy(catalogue);
  assert.deepEqual(policy.resolve('产品价格').categoryIds, [ids[1]]);
  assert.equal(policy.fallback('zero-hits').includeTestSamples, false);
  assert.equal(policy.fallback('evidence-insufficient'), undefined);
  assert.throws(() => policy.resolve('价格', { broaden: true }));
  assert.throws(() => policy.resolve('价格', { categoryIds: [ids[2]] }));
  assert.throws(() =>
    policy.resolve('价格', { categoryIds: ['22222222-2222-4222-8222-222222222222'] }),
  );
});
it('does not expand explicit filters, preserves archived categories and recognizes explicit tests', () => {
  const policy = new CategoryRetrievalPolicy(catalogue, [ids[1]]);
  assert.deepEqual(policy.resolve('价格', { categoryIds: [ids[3]], broaden: true }).categoryIds, [
    ids[1],
  ]);
  assert.equal(policy.fallback('zero-hits'), undefined);
  const archived = new CategoryRetrievalPolicy(
    catalogue.map((item) => ({ ...item, active: item.key !== 'product' })),
    [ids[1]],
  );
  assert.deepEqual(archived.resolve('价格').categoryIds, [ids[1]]);
  assert.equal(isTestSampleQuestion('TC004 纠错测试样例'), true);
  assert.equal(isTestSampleQuestion('客户说这个产品要检测'), false);
  assert.equal(new CategoryRetrievalPolicy(catalogue, [ids[2]]).includeTestSamples, true);
});
it('samples all sheets within a global bound and rejects invented category or sheet IDs', () => {
  const chunks = Array.from({ length: 50 }, (_, index) => ({
    content: 'x'.repeat(2000),
    locator: { kind: 'spreadsheet', sheet: `S${index}`, rowStart: 1, rowEnd: 1 },
  }));
  const samples = buildClassificationSample(chunks);
  assert.equal(samples.length, 50);
  assert.ok(samples.reduce((sum, item) => sum + item.excerpts.length, 0) <= 12000);
  const value = { documentCategoryId: ids[1], sheets: [{ sheet: 'S1', categoryId: ids[2] }] };
  assert.equal(validateClassificationSuggestion(value, catalogue, ['S1']).status, 'pending');
  assert.throws(() => validateClassificationSuggestion(value, catalogue, []));
  assert.throws(() =>
    validateClassificationSuggestion(
      { ...value, documentCategoryId: '22222222-2222-4222-8222-222222222222' },
      catalogue,
      ['S1'],
    ),
  );
});
it('turns model timeouts and invalid output into non-blocking failed suggestions', async () => {
  for (const invoke of [
    async () => {
      throw new Error('timeout');
    },
    async () => ({ content: '{"documentCategoryId":"invented","sheets":[]}' }),
  ]) {
    const classifier = new KnowledgeClassifier(async () => ({
      name: 'fake-model',
      model: { invoke },
    }));
    const result = await classifier.suggest('fixture', [], catalogue, noOpAiExecutionRecorder);
    assert.equal(result.status, 'failed');
    assert.equal(result.documentCategoryId, null);
  }
});
it('persists a suggestion once across ingestion retries and skips collected cases', async () => {
  let calls = 0;
  const saved = [];
  const nodes = createIngestionNodes({
    repository: { saveIngestionSuggestion: async (_job, value) => saved.push(value) },
    suggestCategories: async () => {
      calls++;
      throw new Error('provider unavailable');
    },
  });
  const result = await nodes.classifyNode({
    job: {},
    parsed: { chunks: [] },
    report: noOpAiExecutionRecorder,
  });
  assert.equal(result.categorySuggestion.status, 'failed');
  assert.equal(saved.length, 1);
  await nodes.classifyNode({
    job: { categorySuggestion: result.categorySuggestion },
    parsed: { chunks: [] },
    report: noOpAiExecutionRecorder,
  });
  await nodes.classifyNode({
    job: { caseId: ids[0] },
    parsed: { chunks: [] },
    report: noOpAiExecutionRecorder,
  });
  assert.equal(calls, 1);
});
it('applies category and test exclusions in tenant-scoped SQL without changing result budgets', async () => {
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [] };
    },
    release() {},
  };
  const search = new PostgresKnowledgeSearch({ connect: async () => client }, 'fixture', ids[0]);
  await search.searchMany([ids[1]], [1, 0], 'model', {
    categoryIds: [ids[3]],
    includeTestSamples: false,
    reason: 'auto',
  });
  const query = calls.find((item) => /SELECT c.id/.test(item.sql));
  assert.match(query.sql, /c\.tenant_id = \$1/);
  assert.match(query.sql, /c\.knowledge_base_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(query.sql, /c\.category_id=ANY\(\$5::uuid\[\]\)/);
  assert.match(query.sql, /key='test'/);
  assert.match(query.sql, /active_revision_id = c.revision_id/);
  assert.match(query.sql, /LIMIT 20/);
  assert.deepEqual(query.values[4], [ids[3]]);
  assert.equal(query.values[5], false);
  assert.ok(calls.some((item) => /hnsw.iterative_scan/.test(item.sql)));
});
