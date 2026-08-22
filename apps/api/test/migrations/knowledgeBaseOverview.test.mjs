/**
 * 知识库概览迁移契约测试。
 *
 * 静态验证只读配置字段具有稳定默认值和未来可启用的枚举边界。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/003_knowledge_base_overview.sql', import.meta.url),
  'utf8',
);

describe('knowledge base overview migration', () => {
  it('adds every readonly setting with current runtime defaults', () => {
    assert.match(migration, /storage_location text NOT NULL DEFAULT 'local'/);
    assert.match(migration, /indexing_mode text NOT NULL DEFAULT 'rag'/);
    assert.match(migration, /embedding_model text NOT NULL DEFAULT 'qwen\/qwen3-embedding-8b'/);
    assert.match(migration, /reranker_model text/);
    assert.match(migration, /parsing_mode text NOT NULL DEFAULT 'automatic'/);
  });

  it('constrains storage, indexing, and parsing modes', () => {
    assert.match(migration, /storage_location IN \('local', 'cloud'\)/);
    assert.match(migration, /indexing_mode IN \('full_context', 'rag'\)/);
    assert.match(migration, /parsing_mode IN \('automatic', 'manual'\)/);
  });
});
