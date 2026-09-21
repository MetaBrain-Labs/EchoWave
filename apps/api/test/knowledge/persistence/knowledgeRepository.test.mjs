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
});
