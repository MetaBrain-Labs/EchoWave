/**
 * 知识重排迁移契约测试。
 *
 * 静态验证默认开启、历史语义回填、审计字段和能力约束。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/044_knowledge_reranking.sql', import.meta.url),
  'utf8',
);

describe('knowledge reranking migration', () => {
  it('adds the fixed capability and tenant setting default', () => {
    assert.match(migration, /'knowledge_rerank'/);
    assert.match(migration, /rerank_enabled boolean NOT NULL DEFAULT true/);
    assert.match(migration, /revision integer NOT NULL DEFAULT 1/);
  });

  it('preserves historical run and queued-job semantics', () => {
    assert.match(migration, /UPDATE rag_runs SET rerank_enabled = false/);
    assert.match(migration, /UPDATE audio_business_analysis_jobs SET rerank_enabled = false/);
    assert.match(migration, /rerank_tokens integer NOT NULL DEFAULT 0/);
    assert.match(migration, /rerank_binding_revision_id/);
  });
});
