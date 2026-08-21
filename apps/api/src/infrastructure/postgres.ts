/**
 * PostgreSQL 连接适配器。
 *
 * 负责创建连接池、注册 pgvector 类型并生成安全连接信息，为上层持久化模块提供
 * 统一数据库入口。
 *
 * Responsibilities:
 * - 校验并引用动态 PostgreSQL 标识符。
 * - 创建带 pgvector 类型支持的连接池。
 * - 生成 LangGraph checkpointer 使用的连接字符串。
 *
 * Notes:
 * - 本文件不包含领域 SQL 或迁移逻辑。
 */
import pg from 'pg';
import { registerTypes } from 'pgvector/pg';

import type { ApiConfig } from '../config/env.ts';

const { Pool } = pg;

/** 应用共享的 PostgreSQL 连接池类型。 */
export type DatabasePool = pg.Pool;

/** 校验并引用动态 PostgreSQL 标识符，阻止 schema/table 名注入。 */
export function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

/** 创建已注册 pgvector 类型、具有显式连接上限的数据库连接池。 */
export function createDatabasePool(config: ApiConfig['database']): DatabasePool {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    onConnect: async (client) => {
      // pg-pool 会在连接交给调用方前等待此钩子，避免普通 connect 事件与首个查询发生竞态。
      await registerTypes(client);
    },
  });

  return pool;
}

/** 生成供 LangGraph PostgreSQL checkpointer 使用的编码安全连接字符串。 */
export function createPostgresConnectionString(config: ApiConfig['database']): string {
  const user = encodeURIComponent(config.user);
  const password = encodeURIComponent(config.password);
  const database = encodeURIComponent(config.database);
  const sslMode = config.ssl ? 'verify-full' : 'disable';
  return `postgresql://${user}:${password}@${config.host}:${config.port}/${database}?sslmode=${sslMode}`;
}
