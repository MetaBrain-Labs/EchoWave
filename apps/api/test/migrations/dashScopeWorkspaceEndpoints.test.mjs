/**
 * 百炼业务空间端点迁移测试。
 *
 * 静态验证重排绑定只从现有 DashScope 知识向量绑定补齐，并保持幂等。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/045_dashscope_workspace_endpoints.sql', import.meta.url),
  'utf8',
);

describe('DashScope workspace endpoint migration', () => {
  it('backfills only missing rerank bindings from DashScope embeddings', () => {
    assert.match(migration, /binding\.capability = 'knowledge_embedding'/);
    assert.match(migration, /connection\.provider_type = 'dashscope'/);
    assert.match(migration, /existing\.capability = 'knowledge_rerank'/);
    assert.match(migration, /'qwen3\.7-text-rerank'/);
  });

  it('uses uniqueness conflict handling and publishes the new revision pointer', () => {
    assert.match(migration, /ON CONFLICT \(tenant_id, capability\) DO NOTHING/);
    assert.match(migration, /SET current_revision_id = revision\.id/);
  });
});
