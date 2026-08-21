/**
 * 知识库概览仓储测试。
 *
 * 验证详情聚合和只计算活动分组的关联数量。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { KnowledgeRepository } from '../../../dist/knowledge/persistence/knowledgeRepository.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const knowledgeId = '22222222-2222-4222-8222-222222222222';

describe('KnowledgeRepository overview', () => {
  it('maps stored settings and derived document statistics', async () => {
    const calls = [];
    const pool = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [{
          id: knowledgeId,
          name: '产品知识库',
          description: '',
          updated_at: new Date('2026-08-21T10:00:00.000Z'),
          storage_location: 'local',
          indexing_mode: 'rag',
          embedding_model: 'qwen/qwen3-embedding-8b',
          reranker_model: null,
          parsing_mode: 'automatic',
          document_count: 4,
          total_size_bytes: '4096',
          parsed_document_count: 2,
          pending_document_count: 2,
          last_uploaded_at: new Date('2026-08-21T09:30:00.000Z'),
          linked_group_count: 1,
        }] };
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
});
