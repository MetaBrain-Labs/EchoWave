/**
 * 知识库概览仓储测试。
 *
 * 验证详情聚合和只计算活动分组的关联数量。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { KnowledgeRepository } from '../../../dist/knowledge/catalog/knowledgeRepository.js';
import { PostgresKnowledgeSearch } from '../../../dist/knowledge/retrieval/postgresKnowledgeSearch.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const knowledgeId = '22222222-2222-4222-8222-222222222222';

describe('KnowledgeRepository overview', () => {
  it('maps stored settings and derived document statistics', async () => {
    const calls = [];
    const pool = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return {
          rows: [
            {
              id: knowledgeId,
              name: '产品知识库',
              description: '',
              updated_at: new Date('2026-08-21T10:00:00.000Z'),
              storage_location: 'local',
              indexing_mode: 'rag',
              embedding_model: 'qwen3.7-text-embedding',
              reranker_model: null,
              parsing_mode: 'automatic',
              document_count: 4,
              total_size_bytes: '4096',
              parsed_document_count: 2,
              pending_document_count: 2,
              last_uploaded_at: new Date('2026-08-21T09:30:00.000Z'),
              linked_group_count: 1,
            },
          ],
        };
      },
    };
    const repository = new KnowledgeRepository(pool, 'echowave', tenantId);

    const detail = await repository.getKnowledgeBase(knowledgeId);

    assert.equal(detail.totalSizeBytes, 4096);
    assert.equal(detail.parsedDocumentCount, 2);
    assert.equal(detail.pendingDocumentCount, 2);
    assert.equal(detail.settings.rerankerModel, null);
    assert.equal(detail.lastUploadedAt, '2026-08-21T09:30:00.000Z');
    assert.match(calls[0].sql, /d\.status NOT IN \('ready', 'deleting'\)/);
    assert.match(calls[0].sql, /g\.deleted_at IS NULL/);
    assert.deepEqual(calls[0].values, [tenantId, knowledgeId]);
  });

  it('filters retrieval by the current embedding model', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [] };
      },
      release: () => undefined,
    };
    const repository = new PostgresKnowledgeSearch(
      { connect: async () => client },
      'echowave',
      tenantId,
    );
    await repository.search(knowledgeId, Array(1024).fill(0), 'qwen3.7-text-embedding');
    const retrieval = calls.find(({ sql }) => /document_chunks/.test(sql));
    assert.match(retrieval.sql, /c\.embedding_model = \$4/);
    assert.equal(retrieval.values[3], 'qwen3.7-text-embedding');
  });

  it('returns chunk metadata, deduplicates within heading context, and budgets the full payload', async () => {
    const documentOne = '33333333-3333-4333-8333-333333333333';
    const documentTwo = '44444444-4444-4444-8444-444444444444';
    const revision = '55555555-5555-4555-8555-555555555555';
    const base = {
      knowledge_base_id: knowledgeId,
      revision_id: revision,
      document_title: '手册.md',
      title: '产品 / 规格',
      heading_path: ['产品', '规格'],
      content_kind: 'table',
      title_source: 'heading',
      part_index: 1,
      part_count: 2,
      content: '相同正文',
      content_sha256: 'a'.repeat(64),
      locator: {
        kind: 'markdown',
        headingPath: ['产品', '规格'],
        lineStart: 2,
        lineEnd: 4,
      },
      distance: 0.1,
    };
    const rows = [
      { ...base, id: '66666666-6666-4666-8666-666666666661', document_id: documentOne },
      { ...base, id: '66666666-6666-4666-8666-666666666662', document_id: documentTwo },
      {
        ...base,
        id: '66666666-6666-4666-8666-666666666663',
        document_id: documentTwo,
        title: '售后 / 规格',
        heading_path: ['售后', '规格'],
      },
      {
        ...base,
        id: '66666666-6666-4666-8666-666666666664',
        document_id: documentTwo,
        title: '超长标题'.repeat(3_100),
        heading_path: ['超长'],
        content_sha256: 'b'.repeat(64),
      },
    ];
    const client = {
      query: async (sql) => ({ rows: /SELECT c\.id/.test(sql) ? rows : [] }),
      release: () => undefined,
    };
    const repository = new PostgresKnowledgeSearch(
      { connect: async () => client },
      'echowave',
      tenantId,
    );

    const selected = await repository.search(
      knowledgeId,
      Array(1024).fill(0),
      'qwen3.7-text-embedding',
    );

    assert.equal(selected.length, 2);
    assert.deepEqual(
      selected.map((chunk) => chunk.headingPath),
      [
        ['产品', '规格'],
        ['售后', '规格'],
      ],
    );
    assert.equal(selected[0].title, '产品 / 规格');
    assert.equal(selected[0].contentKind, 'table');
    assert.equal(selected[0].partCount, 2);
  });

  it('reranks recalled candidates stably and falls back to vector order when unconfigured', async () => {
    const revision = '55555555-5555-4555-8555-555555555555';
    const rows = [0, 1, 2].map((index) => ({
      id: `66666666-6666-4666-8666-66666666666${index + 1}`,
      knowledge_base_id: knowledgeId,
      document_id: `33333333-3333-4333-8333-33333333333${index + 1}`,
      revision_id: revision,
      document_title: `文档${index + 1}`,
      title: `标题${index + 1}`,
      heading_path: ['章节'],
      content_kind: 'prose',
      title_source: 'heading',
      part_index: 1,
      part_count: 1,
      content: `正文${index + 1}`,
      embedding_text: `文档${index + 1}\n标题${index + 1}\n章节\nprose\n正文${index + 1}`,
      content_sha256: String(index + 1).repeat(64),
      locator: { kind: 'markdown', headingPath: ['章节'], lineStart: 1, lineEnd: 1 },
      distance: 0.1 + index * 0.1,
    }));
    const client = {
      query: async (sql) => ({ rows: /SELECT c\.id/.test(sql) ? rows : [] }),
      release: () => undefined,
    };
    const repository = new PostgresKnowledgeSearch(
      { connect: async () => client },
      'echowave',
      tenantId,
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          output: {
            results: [
              { index: 0, relevance_score: 0.2 },
              { index: 1, relevance_score: 0.9 },
              { index: 2, relevance_score: 0.9 },
            ],
          },
          usage: { total_tokens: 9 },
        }),
        { status: 200 },
      );
    try {
      const reranked = await repository.searchDetailed(
        knowledgeId,
        Array(1024).fill(0),
        'qwen3.7-text-embedding',
        undefined,
        {
          query: '问题',
          rerank: {
            enabled: true,
            revision: 1,
            bindingRevisionId: '77777777-7777-4777-8777-777777777777',
            model: 'qwen3.7-text-rerank',
            apiKey: 'test-key',
            baseUrl: 'https://workspace.example.com/api/v1',
          },
        },
      );
      assert.deepEqual(
        reranked.chunks.map((chunk) => chunk.id),
        [rows[1].id, rows[2].id, rows[0].id],
      );
      assert.equal(reranked.audit.rerankStatus, 'applied');
      assert.equal(reranked.audit.rerankTokens, 9);

      const fallback = await repository.searchDetailed(
        knowledgeId,
        Array(1024).fill(0),
        'qwen3.7-text-embedding',
        undefined,
        {
          query: '问题',
          rerank: {
            enabled: true,
            revision: 1,
            bindingRevisionId: null,
            model: 'qwen3.7-text-rerank',
            apiKey: '',
            baseUrl: '',
          },
        },
      );
      assert.deepEqual(
        fallback.chunks.map((chunk) => chunk.id),
        rows.map((row) => row.id),
      );
      assert.equal(fallback.audit.rerankStatus, 'fallback');
      assert.equal(fallback.audit.fallbackReason, 'NOT_CONFIGURED');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
