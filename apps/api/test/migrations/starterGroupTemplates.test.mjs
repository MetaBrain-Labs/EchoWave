/**
 * 起步分组模板迁移测试。
 *
 * 验证模板身份和租户目录版本的数据库约束存在。
 *
 * Responsibilities:
 * - 锁定分组与数据源的租户内唯一键。
 * - 锁定一次性安装标记与租户级联。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/033_starter_group_templates.sql', import.meta.url),
  'utf8',
);

describe('starter group template migration', () => {
  it('adds durable template identities and a catalog installation marker', () => {
    assert.match(migration, /ALTER TABLE groups[\s\S]*ADD COLUMN starter_template_key text/);
    assert.match(migration, /groups_tenant_starter_template_key_idx/);
    assert.match(migration, /ALTER TABLE data_sources[\s\S]*ADD COLUMN starter_template_key text/);
    assert.match(migration, /data_sources_tenant_starter_template_key_idx/);
    assert.match(migration, /CREATE TABLE starter_template_installations/);
    assert.match(migration, /PRIMARY KEY \(tenant_id, catalog_version\)/);
    assert.match(migration, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  });
});
