/**
 * 起步分组模板安装器测试。
 *
 * 验证目录版本幂等、模板配置与事务回滚。
 *
 * Responsibilities:
 * - 锁定两个分组、共享数据源和关联写入。
 * - 防止重复运行覆盖用户已有模板。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  provisionStarterTemplates,
  STARTER_TEMPLATE_CATALOG_VERSION,
} from '../../dist/workspace/starter-templates/provisioner.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('starter template provisioner', () => {
  it('installs two configured groups and one shared upload source atomically', async () => {
    const calls = [];
    let groupIndex = 0;
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/starter_template_installations/.test(sql)) {
          return { rowCount: 1, rows: [{ catalog_version: 1 }] };
        }
        if (/INSERT INTO .*data_sources/.test(sql)) {
          return { rowCount: 1, rows: [{ id: '22222222-2222-4222-8222-222222222222' }] };
        }
        if (/INSERT INTO .*groups/.test(sql)) {
          groupIndex += 1;
          return {
            rowCount: 1,
            rows: [{ id: `33333333-3333-4333-8333-33333333333${groupIndex}` }],
          };
        }
        return { rowCount: 1, rows: [] };
      },
      release: () => {
        client.released = true;
      },
      released: false,
    };

    await provisionStarterTemplates({ connect: async () => client }, 'echowave', tenantId);

    assert.equal(calls[0].sql, 'BEGIN');
    assert.deepEqual(calls[1].values, [tenantId, STARTER_TEMPLATE_CATALOG_VERSION]);
    assert.equal(calls.filter((call) => /INSERT INTO .*groups/.test(call.sql)).length, 2);
    assert.equal(
      calls.filter((call) => /INSERT INTO .*group_analysis_settings/.test(call.sql)).length,
      2,
    );
    assert.equal(
      calls.filter((call) => /INSERT INTO .*group_data_sources/.test(call.sql)).length,
      2,
    );
    assert.match(calls[2].sql, /starter_audio_upload/);
    assert.match(calls[3].sql, /starter_template_key/);
    assert.equal(calls.at(-1).sql, 'COMMIT');
    assert.equal(client.released, true);
  });

  it('does not rewrite catalog rows after the installation marker exists', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return /starter_template_installations/.test(sql)
          ? { rowCount: 0, rows: [] }
          : { rowCount: 1, rows: [] };
      },
      release: () => undefined,
    };

    await provisionStarterTemplates({ connect: async () => client }, 'echowave', tenantId);

    assert.deepEqual(
      calls.map((call) => (call.sql === 'BEGIN' || call.sql === 'COMMIT' ? call.sql : 'marker')),
      ['BEGIN', 'marker', 'COMMIT'],
    );
  });

  it('rolls back the installation marker and catalog when any write fails', async () => {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(sql);
        if (/INSERT INTO .*data_sources/.test(sql)) throw new Error('source unavailable');
        return { rowCount: 1, rows: [{ catalog_version: 1 }] };
      },
      release: () => undefined,
    };

    await assert.rejects(
      () => provisionStarterTemplates({ connect: async () => client }, 'echowave', tenantId),
      /source unavailable/,
    );
    assert.equal(calls.at(-1), 'ROLLBACK');
  });
});
