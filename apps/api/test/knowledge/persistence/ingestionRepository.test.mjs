/**
 * 知识文档重新入库测试。
 *
 * 验证嵌入模型迁移后的同文件上传会复用文档并创建新模型修订。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { IngestionRepository } from '../../../dist/knowledge/persistence/ingestionRepository.js';

describe('IngestionRepository model migration recovery', () => {
  it('reuses a migration-blocked document for the same source hash', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (/SELECT 1 FROM/.test(sql)) return { rowCount: 1, rows: [{}] };
        if (/SELECT d\.id, d\.error_code/.test(sql)) {
          return {
            rows: [
              {
                id: 'document-1',
                error_code: 'EMBEDDING_MODEL_MIGRATION_REQUIRED',
              },
            ],
          };
        }
        if (/INSERT INTO .*document_revisions/.test(sql)) return { rows: [{ id: 'revision-2' }] };
        if (/INSERT INTO .*ingestion_jobs/.test(sql)) return { rows: [{ id: 'job-2' }] };
        return { rows: [] };
      },
      release: () => undefined,
    };
    const repository = new IngestionRepository(
      { connect: async () => client },
      'echowave',
      'tenant-1',
    );
    const result = await repository.createIngestion({
      knowledgeBaseId: 'knowledge-1',
      title: '产品资料.md',
      format: 'markdown',
      sizeBytes: 100,
      sourceSha256: 'same-sha',
      stagedPath: '.tmp/uploads/staged.md',
      parserVersion: '1',
      embeddingModel: 'qwen3.7-text-embedding',
    });
    assert.deepEqual(result, { documentId: 'document-1', jobId: 'job-2' });
    assert.ok(calls.some(({ sql }) => /UPDATE .*documents/.test(sql)));
    const revision = calls.find(({ sql }) => /INSERT INTO .*document_revisions/.test(sql));
    assert.equal(revision.values[4], 'qwen3.7-text-embedding');
    assert.equal(
      calls.some(({ sql }) => /INSERT INTO .*documents\s/.test(sql)),
      false,
    );
  });
});
