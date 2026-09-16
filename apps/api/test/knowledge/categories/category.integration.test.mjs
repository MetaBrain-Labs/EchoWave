/** 知识类别真实数据库回归：只操作随机隔离 schema，显式启用才连接 API .env。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { it } from 'node:test';
import { readApiConfigFile } from '../../../dist/config/env.js';
import { createDatabasePool, quoteIdentifier } from '../../../dist/infrastructure/postgres.js';
import { KnowledgeRepository } from '../../../dist/knowledge/catalog/knowledgeRepository.js';
import { IngestionRepository } from '../../../dist/knowledge/persistence/ingestionRepository.js';
import { KnowledgeCategoryRepository } from '../../../dist/knowledge/categories/categoryRepository.js';
import { PostgresKnowledgeSearch } from '../../../dist/knowledge/retrieval/postgresKnowledgeSearch.js';
import { BusinessAnalysisRepository } from '../../../dist/workspace/audio/business-analysis/repository.js';

it(
  'preserves provenance and vectors while category filters narrow mixed knowledge',
  { skip: process.env.ECHOWAVE_LIVE_KNOWLEDGE_TEST !== '1', timeout: 120000 },
  async () => {
    const config = readApiConfigFile(new URL('../../../.env', import.meta.url));
    const pool = createDatabasePool(config.database, { registerVectorTypes: false });
    const schema = `echowave_category_test_${randomUUID().replaceAll('-', '')}`;
    const quoted = quoteIdentifier(schema);
    const tenant = randomUUID();
    const otherTenant = randomUUID();
    let created = false;
    try {
      assert.equal(
        (await pool.query("SELECT 1 FROM pg_extension WHERE extname='vector'")).rowCount,
        1,
      );
      await pool.query(`CREATE SCHEMA ${quoted}`);
      created = true;
      const client = await pool.connect();
      try {
        const root = new URL('../../../migrations/', import.meta.url);
        for (const name of (await readdir(root))
          .filter((name) => /^\d{3}_[A-Za-z0-9_]+\.sql$/.test(name))
          .sort()) {
          await client.query('BEGIN');
          await client.query(`SET LOCAL search_path TO ${quoted},public`);
          await client.query(await readFile(new URL(name, root), 'utf8'));
          await client.query('COMMIT');
        }
      } finally {
        client.release();
      }
      await pool.query(
        `INSERT INTO ${quoted}.tenants(id,name) VALUES($1,'fixture'),($2,'other fixture')`,
        [tenant, otherTenant],
      );
      const knowledge = new KnowledgeRepository(pool, schema, tenant);
      const categories = new KnowledgeCategoryRepository(pool, schema, tenant);
      const ingestion = new IngestionRepository(pool, schema, tenant);
      const search = new PostgresKnowledgeSearch(pool, schema, tenant);
      const catalogue = (await categories.list()).items;
      assert.equal(catalogue.length, 7);
      const category = (key) => catalogue.find((item) => item.key === key).id;
      const kb = await knowledge.createKnowledgeBase({ name: 'Mixed fixture', description: '' });
      assert.equal(kb.defaultCategoryId, category('general'));
      const vector = Array(1024).fill(0);
      vector[0] = 1;
      const sheets = ['Products', 'Rules', 'Tests'];
      const chunks = sheets.map((sheet, index) => ({
        index: index + 1,
        title: sheet,
        headingPath: [sheet],
        content: `${sheet}: safe fixture ${index}`,
        embeddingText: `${sheet}: safe fixture ${index}`,
        contentSha256: String(index).repeat(64),
        locator: { kind: 'spreadsheet', sheet, rowStart: 5, rowEnd: 5 },
      }));
      const upload = await ingestion.createIngestion({
        knowledgeBaseId: kb.id,
        title: 'mixed.xlsx',
        format: 'spreadsheet',
        sizeBytes: 1,
        sourceSha256: 'a'.repeat(64),
        stagedPath: '',
        parserVersion: 'fixture',
        embeddingModel: 'fixture',
        embeddingBindingRevisionId: null,
      });
      const job = await ingestion.claimIngestionJob();
      assert.equal(job.documentId, upload.documentId);
      await ingestion.publishRevision({
        job,
        chunks,
        vectors: chunks.map(() => vector),
        previewText: 'fixture',
        warnings: [],
        provider: 'fixture',
        embeddingTokens: 0,
        estimatedCost: { amount: 0, currency: 'USD' },
        embeddingModel: 'fixture',
        categorySuggestion: {
          status: 'pending',
          documentCategoryId: category('product'),
          sheets: [{ sheet: 'Tests', categoryId: category('test') }],
          message: '',
        },
      });
      let state = await categories.getClassification(kb.id, upload.documentId);
      assert.equal(state.documentCategoryId, null);
      const before = (
        await pool.query(
          `SELECT id,content,content_sha256,embedding::text FROM ${quoted}.document_chunks ORDER BY id`,
        )
      ).rows;
      const inheritedKb = await knowledge.getKnowledgeBase(kb.id);
      await knowledge.updateKnowledgeBase(kb.id, {
        defaultCategoryId: category('product'),
        expectedCategoryVersion: inheritedKb.categoryVersion,
      });
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM ${quoted}.document_chunks WHERE category_id=$1 AND category_source='knowledge_base'`,
            [category('product')],
          )
        ).rows[0].count,
        3,
      );
      const restoredKb = await knowledge.getKnowledgeBase(kb.id);
      await knowledge.updateKnowledgeBase(kb.id, {
        defaultCategoryId: category('general'),
        expectedCategoryVersion: restoredKb.categoryVersion,
      });
      const snapshot = (await search.availableCategories([kb.id])).versions.map((item) => ({
        id: item.id,
        version: item.version,
      }));
      const confirm = {
        revisionId: state.revisionId,
        expectedVersion: state.version,
        expectedDocumentVersion: state.documentVersion,
        documentCategoryId: category('sop'),
        sheetAssignments: [
          { sheet: 'Products', categoryId: category('product') },
          { sheet: 'Tests', categoryId: category('test') },
        ],
        confirmSuggestion: true,
      };
      state = await categories.updateClassification(kb.id, upload.documentId, confirm);
      assert.equal(state.suggestion.status, 'confirmed');
      await assert.rejects(
        categories.updateClassification(kb.id, upload.documentId, confirm),
        (error) => error.code === 'CONFLICT',
      );
      await assert.rejects(
        categories.updateClassification(kb.id, upload.documentId, {
          ...confirm,
          expectedVersion: state.version,
          sheetAssignments: [{ sheet: 'Missing', categoryId: category('sop') }],
        }),
        (error) => error.code === 'CONFLICT',
      );
      const effective = (
        await pool.query(
          `SELECT locator->>'sheet' AS sheet,category_id,category_source FROM ${quoted}.document_chunks ORDER BY chunk_index`,
        )
      ).rows;
      assert.deepEqual(
        effective.map((row) => [row.sheet, row.category_id, row.category_source]),
        [
          ['Products', category('product'), 'sheet'],
          ['Rules', category('sop'), 'document'],
          ['Tests', category('test'), 'sheet'],
        ],
      );
      assert.deepEqual(
        (
          await pool.query(
            `SELECT id,content,content_sha256,embedding::text FROM ${quoted}.document_chunks ORDER BY id`,
          )
        ).rows,
        before,
      );
      const filtered = await search.searchMany([kb.id], vector, 'fixture', {
        categoryIds: [category('product')],
        includeTestSamples: false,
        reason: 'explicit',
      });
      const broad = await search.searchMany([kb.id], vector, 'fixture');
      assert.equal(filtered.length, 1);
      assert.equal(broad.length, 2);
      assert.equal(
        broad.some((chunk) => chunk.locator.sheet === 'Tests'),
        false,
      );
      assert.equal(
        (
          await search.searchMany([kb.id], vector, 'fixture', {
            categoryIds: [category('test')],
            includeTestSamples: true,
            reason: 'explicit',
          })
        ).length,
        1,
      );
      const otherCategories = new KnowledgeCategoryRepository(pool, schema, otherTenant);
      const foreign = (await otherCategories.list()).items[0].id;
      await assert.rejects(
        knowledge.createKnowledgeBase({
          name: 'Foreign category',
          description: '',
          defaultCategoryId: foreign,
        }),
        (error) => error.code === 'CONFLICT',
      );
      assert.deepEqual(
        await new PostgresKnowledgeSearch(pool, schema, otherTenant).searchMany(
          [kb.id],
          vector,
          'fixture',
        ),
        [],
      );
      assert.deepEqual(await search.searchMany([randomUUID()], vector, 'fixture'), []);
      assert.deepEqual(await search.searchMany([kb.id], vector, 'another-model'), []);
      await assert.rejects(
        categories.updateClassification(kb.id, upload.documentId, {
          ...confirm,
          expectedVersion: state.version,
          documentCategoryId: foreign,
        }),
        (error) => error.code === 'CONFLICT',
      );
      const currentKb = await knowledge.getKnowledgeBase(kb.id);
      await knowledge.updateKnowledgeBase(kb.id, {
        defaultCategoryId: category('product'),
        expectedCategoryVersion: currentKb.categoryVersion,
      });
      assert.equal(
        (
          await pool.query(
            `SELECT category_id FROM ${quoted}.document_chunks WHERE locator->>'sheet'='Rules'`,
          )
        ).rows[0].category_id,
        category('sop'),
      );
      const business = new BusinessAnalysisRepository(pool, schema, tenant);
      await assert.rejects(
        business.assertKnowledgeCurrent({
          knowledgeBaseIds: [kb.id],
          knowledgeVersionSnapshot: snapshot,
        }),
      );
      const product = catalogue.find((item) => item.key === 'product');
      await categories.update(product.id, { active: false, expectedVersion: product.version });
      await assert.rejects(
        categories.updateClassification(kb.id, upload.documentId, {
          ...confirm,
          expectedVersion: state.version,
          documentCategoryId: product.id,
        }),
        (error) => error.code === 'CONFLICT',
      );
      const custom = await categories.create({
        name: 'Custom fixture',
        description: 'Custom factual rules',
      });
      assert.equal(custom.key, null);
      await assert.rejects(
        categories.create({ name: 'Custom fixture', description: 'duplicate' }),
        (error) => error.code === 'CONFLICT',
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM ${quoted}.knowledge_classification_history`,
          )
        ).rows[0].count > 0,
        true,
      );
      // 捕获实际检索 SQL，用相同白名单、模型、revision 和 HNSW 参数检查执行计划。
      let query;
      const planSearch = new PostgresKnowledgeSearch(
        {
          connect: async () => {
            const client = await pool.connect();
            return {
              query: async (sql, parameters) => {
                if (sql.startsWith('SELECT c.id')) query = { sql, parameters };
                return client.query(sql, parameters);
              },
              release: () => client.release(),
            };
          },
        },
        schema,
        tenant,
      );
      await planSearch.searchMany([kb.id], vector, 'fixture', {
        categoryIds: [category('sop')],
        includeTestSamples: false,
        reason: 'auto',
      });
      const planClient = await pool.connect();
      let plan;
      let baselinePlan;
      try {
        await planClient.query('BEGIN');
        await planClient.query('SET LOCAL hnsw.ef_search = 100');
        await planClient.query("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
        plan = await planClient.query(
          `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query.sql}`,
          query.parameters,
        );
        const baselineParameters = [...query.parameters];
        baselineParameters[4] = null;
        baselinePlan = await planClient.query(
          `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query.sql}`,
          baselineParameters,
        );
        await planClient.query('COMMIT');
      } finally {
        planClient.release();
      }
      assert.equal(typeof plan.rows[0]['QUERY PLAN'][0]['Execution Time'], 'number');
      assert.equal(
        (
          await pool.query(
            `SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname='document_chunks_category_scope_idx'`,
            [schema],
          )
        ).rowCount,
        1,
      );
      console.info('Category fixture benchmark', {
        baselineHits: broad.length,
        categoryHits: filtered.length,
        executionMs: plan.rows[0]['QUERY PLAN'][0]['Execution Time'],
        baselineExecutionMs: baselinePlan.rows[0]['QUERY PLAN'][0]['Execution Time'],
        plan: plan.rows[0]['QUERY PLAN'][0].Plan['Node Type'],
        relevantEvidenceHits: filtered.filter((chunk) => chunk.locator.sheet === 'Products').length,
        baselineIrrelevantHits: broad.filter((chunk) => chunk.locator.sheet !== 'Products').length,
        filteredIrrelevantHits: filtered.filter((chunk) => chunk.locator.sheet !== 'Products')
          .length,
        planNodes: summarizePlan(plan.rows[0]['QUERY PLAN'][0].Plan),
      });
    } finally {
      if (created && /^echowave_category_test_[a-f0-9]{32}$/.test(schema))
        await pool.query(`DROP SCHEMA ${quoted} CASCADE`);
      await pool.end();
    }
  },
);

/** 只输出执行节点和索引名称，不暴露真实 SQL 参数或文档内容。 */
function summarizePlan(node) {
  return [
    { type: node['Node Type'], index: node['Index Name'] ?? null },
    ...(node.Plans ?? []).flatMap(summarizePlan),
  ];
}
