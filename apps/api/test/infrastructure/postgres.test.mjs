/**
 * PostgreSQL 连接池配置测试。
 *
 * 锁定普通运行时与首次迁移对 pgvector 类型注册的不同启动要求，防止迁移再次
 * 在创建 vector 扩展之前因连接初始化失败。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDatabasePool } from '../../dist/infrastructure/postgres.js';

const databaseConfig = {
  host: '127.0.0.1',
  port: 5432,
  user: 'echowave',
  password: 'unused',
  database: 'echowave',
  ssl: false,
};

describe('createDatabasePool', () => {
  it('registers vector types for regular runtime connections by default', async () => {
    const pool = createDatabasePool(databaseConfig);

    try {
      assert.equal(typeof pool.options.onConnect, 'function');
    } finally {
      await pool.end();
    }
  });

  it('creates migration connections without requiring the vector type first', async () => {
    const pool = createDatabasePool(databaseConfig, { registerVectorTypes: false });

    try {
      assert.equal(Object.hasOwn(pool.options, 'onConnect'), false);
    } finally {
      await pool.end();
    }
  });
});
