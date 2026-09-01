/**
 * 租户 AI 配置 migration 静态契约测试。
 *
 * 验证版本化 Provider、加密 Credential、能力绑定及任务快照引用不会被后续重构遗漏。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/021_tenant_ai_configuration.sql', import.meta.url),
  'utf8',
);

describe('tenant AI configuration migration', () => {
  it('creates versioned provider and credential boundaries', () => {
    for (const table of [
      'credentials',
      'credential_versions',
      'provider_connections',
      'provider_connection_revisions',
      'ai_capability_bindings',
      'ai_capability_binding_revisions',
      'configuration_imports',
    ]) {
      assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`));
    }
    assert.match(migration, /octet_length\(iv\) = 12/);
    assert.match(migration, /octet_length\(auth_tag\) = 16/);
    assert.match(migration, /credential_source IN \('database', 'local_file'\)/);
  });

  it('adds configuration snapshot references to every AI workflow', () => {
    for (const table of [
      'document_revisions',
      'rag_runs',
      'audio_analysis_revisions',
      'audio_post_analysis_jobs',
      'audio_business_analysis_jobs',
    ]) {
      assert.match(migration, new RegExp(`ALTER TABLE ${table}`));
    }
    assert.match(migration, /REFERENCES ai_capability_binding_revisions\(tenant_id, id\)/);
  });
});
