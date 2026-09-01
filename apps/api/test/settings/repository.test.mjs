/**
 * 租户 AI 配置 Repository 测试。
 *
 * 验证配置读取始终向 PostgreSQL 传递 SQL 中声明的租户参数。
 *
 * Responsibilities:
 * - 锁定供应商列表查询的租户隔离参数。
 *
 * Notes:
 * - 使用最小数据库池替身，不连接真实 PostgreSQL。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SettingsRepository } from '../../dist/settings/repository.js';

describe('SettingsRepository', () => {
  it('passes the tenant ID required by the provider list query', async () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const pool = {
      async query(sql, parameters) {
        assert.match(sql, /WHERE pc\.tenant_id = \$1/);
        assert.deepEqual(parameters, [tenantId]);
        return { rows: [] };
      },
    };
    const repository = new SettingsRepository(pool, 'echowave', tenantId);

    assert.deepEqual(await repository.listProviders(), []);
  });
});
