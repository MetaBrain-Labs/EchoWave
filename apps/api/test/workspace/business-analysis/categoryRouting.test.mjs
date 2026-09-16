/** 业务分析类别路由回归：共用已有规划调用，并行分支共享预算和一次兜底。 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createBusinessAnalysisNodes } from '../../../dist/workspace/audio/business-analysis/graph/nodes.js';
import { BusinessAnalysisRepository } from '../../../dist/workspace/audio/business-analysis/repository.js';
import { noOpAiExecutionRecorder } from '../../../dist/ai-observability/executionReporter.js';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
it('uses one planning call and one expansion across parallel category searches', async () => {
  let plans = 0;
  let calls = 0;
  let expanded = false;
  let embeddingCalls = 0;
  const scopes = [];
  const audits = [];
  const categories = [
    { id, key: 'product', name: '产品', description: 'facts', active: true, version: 0 },
    { id: other, key: 'test', name: '测试', description: 'fixtures', active: true, version: 0 },
  ];
  const job = {
    id,
    knowledgeBaseIds: [id],
    knowledgeBases: [{ id, name: 'mixed' }],
    settings: { contentFocus: 'products' },
    segments: [{ text: '产品规格' }],
  };
  const nodes = createBusinessAnalysisNodes({
    repository: {
      assertKnowledgeCurrent: async () => {},
      updateProgress: async () => {},
      recordCategoryCatalogue: async () => {},
      reserveCategoryRetrieval: async () => {
        calls++;
        return calls <= 5 ? calls : null;
      },
      claimCategoryExpansion: async () => {
        if (expanded) return false;
        expanded = true;
        return true;
      },
      recordCategoryRetrieval: async (_job, audit) => audits.push(audit),
    },
    knowledgeRepository: {
      availableCategories: async () => ({ categories, versions: [] }),
      searchMany: async (ids, _vector, _model, scope) => {
        assert.deepEqual(ids, [id]);
        scopes.push(scope);
        return [];
      },
    },
    embeddings: {
      embedQuery: async () => {
        embeddingCalls++;
        return [1];
      },
    },
    embeddingModel: 'fake',
    agent: {
      planRetrievalQueries: async (_job, _report, catalogue) => {
        plans++;
        assert.deepEqual(
          catalogue.map((item) => item.id),
          [id],
        );
        return ['a', 'b', 'c'].map((query) => ({ query, categoryIds: [id] }));
      },
    },
  });
  const runtime = { context: { report: noOpAiExecutionRecorder, notifyProgress() {} } };
  const state = await nodes.planRetrievalNode({ job }, runtime);
  await Promise.all(
    state.queries.map((query, index) =>
      nodes.retrieveQueryNode(
        {
          job,
          retrievalQuery: query,
          retrievalAttempt: index + 1,
          retrievalCategoryIds: state.queryCategoryIds[query],
        },
        runtime,
      ),
    ),
  );
  assert.equal(plans, 1);
  assert.equal(embeddingCalls, 3);
  assert.equal(scopes.filter((scope) => scope.reason === 'zero-hits').length, 1);
  assert.ok(scopes.every((scope) => !scope.includeTestSamples));
  await nodes.retrieveQueryNode(
    { job, retrievalQuery: 'a', retrievalAttempt: 4, retrievalCategoryIds: [id] },
    runtime,
  );
  await nodes.retrieveQueryNode(
    { job, retrievalQuery: 'a', retrievalAttempt: 5, retrievalCategoryIds: [id] },
    runtime,
  );
  assert.equal(scopes.length, 5);
  assert.equal(embeddingCalls, 3);
  assert.equal(audits.length, 5);
});
it('reserves persisted SQL and expansion budgets atomically for running tenant jobs', async () => {
  const sql = [];
  const repository = new BusinessAnalysisRepository(
    {
      query: async (text, values) => {
        sql.push({ text, values });
        return { rowCount: 1, rows: [{ category_retrieval_calls: 2, id }] };
      },
    },
    'fixture',
    id,
  );
  assert.equal(await repository.reserveCategoryRetrieval(other), 2);
  assert.equal(await repository.claimCategoryExpansion(other), true);
  assert.match(sql[0].text, /category_retrieval_calls<5/);
  assert.match(sql[1].text, /NOT category_fallback_used/);
  assert.ok(
    sql.every((query) => /tenant_id=\$1/.test(query.text) && /status='running'/.test(query.text)),
  );
  assert.deepEqual(sql[0].values, [id, other]);
});
