/**
 * 租户 AI 配置 Repository 测试。
 *
 * 验证配置读取始终向 PostgreSQL 传递 SQL 中声明的租户参数，以及能力绑定在
 * 没有当前 revision 的历史行上会被修复而不是重复插入。
 *
 * Responsibilities:
 * - 锁定供应商列表查询的租户隔离参数。
 * - 锁定能力绑定的乐观锁与唯一约束边界。
 *
 * Notes:
 * - 使用最小数据库池替身，不连接真实 PostgreSQL。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SettingsRepository } from '../../dist/settings/repository.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';
const providerRevisionId = '33333333-3333-4333-8333-333333333333';
const bindingId = '44444444-4444-4444-8444-444444444444';
const bindingRevisionId = '55555555-5555-4555-8555-555555555555';

/** 构造同时支持事务客户端与直连查询的数据库池替身，并按查询意图返回预设结果。 */
function poolStub(handlers) {
  const calls = [];
  const query = async (sql, parameters) => {
    calls.push({ sql, parameters });
    return handlers(sql, parameters);
  };
  return { calls, query, connect: async () => ({ query, release: () => {} }) };
}

/** 构造一次能力绑定写入所需的入参。 */
function bindingWrite(overrides = {}) {
  return {
    bindingId,
    bindingRevisionId,
    capability: 'knowledge_rerank',
    providerConnectionId: connectionId,
    secondaryProviderConnectionId: null,
    model: 'qwen3.7-text-rerank',
    settings: {},
    ...overrides,
  };
}

/** 按 SQL 意图分派：绑定行、残留 revision、供应商当前 revision 与能力列表。 */
function bindingHandlers(bindingRow, nextRevisionNo = 1) {
  return (sql) => {
    if (sql.includes('FOR UPDATE OF binding')) return { rows: bindingRow ? [bindingRow] : [] };
    if (sql.includes('coalesce(max(revision_no)')) {
      return { rows: [{ revision_no: nextRevisionNo }] };
    }
    if (sql.includes('SELECT current_revision_id')) {
      return { rows: [{ current_revision_id: providerRevisionId }] };
    }
    if (sql.includes('ORDER BY binding.capability')) {
      return {
        rows: [
          {
            capability: 'knowledge_rerank',
            revision_no: nextRevisionNo,
            provider_connection_id: connectionId,
            secondary_provider_connection_id: null,
            model: 'qwen3.7-text-rerank',
            settings: {},
            updated_at: new Date('2026-09-03T08:00:00.000Z'),
          },
        ],
      };
    }
    return { rows: [] };
  };
}

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

  it('repairs an unpublished binding row that already carries a stray revision', async () => {
    // 现场数据：绑定行没有当前 revision，但已经存在 revision_no = 1 的未发布 revision。
    const pool = poolStub(bindingHandlers({ id: bindingId, revision_no: null }, 2));
    const repository = new SettingsRepository(pool, 'echowave', tenantId);

    const binding = await repository.saveBinding(bindingWrite());

    // 查找必须容忍没有当前 revision 的历史绑定行，否则会误判为"未绑定"并重复插入。
    const lookup = pool.calls.find(({ sql }) => sql.includes('FOR UPDATE OF binding'));
    assert.match(lookup.sql, /LEFT JOIN "echowave"\."ai_capability_binding_revisions" revision/);
    // 关键回归：已存在的绑定行不能被再次插入，否则会撞唯一约束并让保存以 500 失败。
    assert.equal(
      pool.calls.some(({ sql }) => sql.includes('(id, tenant_id, capability)')),
      false,
    );
    const revisionInsert = pool.calls.find(({ sql }) =>
      sql.includes('(id, tenant_id, binding_id, revision_no'),
    );
    // 版本号必须取自实际存在的 revision，否则会撞 (tenant_id, binding_id, revision_no)。
    assert.deepEqual(revisionInsert.parameters.slice(0, 5), [
      bindingRevisionId,
      tenantId,
      bindingId,
      2,
      providerRevisionId,
    ]);
    assert.equal(binding.capability, 'knowledge_rerank');
  });

  it('publishes the next revision and rejects a stale expected revision', async () => {
    const published = poolStub(bindingHandlers({ id: bindingId, revision_no: 3 }, 4));
    const repository = new SettingsRepository(published, 'echowave', tenantId);

    await repository.saveBinding(bindingWrite({ expectedRevision: 3 }));
    const revisionInsert = published.calls.find(({ sql }) =>
      sql.includes('(id, tenant_id, binding_id, revision_no'),
    );
    assert.equal(revisionInsert.parameters[3], 4);
    assert.equal(
      published.calls.some(({ sql }) => sql.includes('(id, tenant_id, capability)')),
      false,
    );

    const stale = poolStub(bindingHandlers({ id: bindingId, revision_no: 4 }, 5));
    const staleRepository = new SettingsRepository(stale, 'echowave', tenantId);
    await assert.rejects(
      () => staleRepository.saveBinding(bindingWrite({ expectedRevision: 3 })),
      (error) => error.code === 'CONFLICT',
    );
    assert.equal(
      stale.calls.some(({ sql }) => sql === 'ROLLBACK'),
      true,
    );
  });

  it('creates the binding row when the capability has never been bound', async () => {
    const pool = poolStub(bindingHandlers(undefined));
    const repository = new SettingsRepository(pool, 'echowave', tenantId);

    await repository.saveBinding(bindingWrite());

    const bindingInsert = pool.calls.find(({ sql }) => sql.includes('(id, tenant_id, capability)'));
    assert.deepEqual(bindingInsert.parameters, [bindingId, tenantId, 'knowledge_rerank']);
  });
});
