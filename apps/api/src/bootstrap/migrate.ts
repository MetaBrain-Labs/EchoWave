/**
 * 数据库迁移入口。
 *
 * 负责按名称顺序应用显式 SQL migration，并初始化独立的 LangGraph checkpoint schema；
 * 普通 API 启动不会调用此流程。
 *
 * Responsibilities:
 * - 记录并幂等应用未执行的业务 migration。
 * - 初始化 checkpointer 所需表结构。
 * - 在失败时回滚当前 migration 并关闭资源。
 *
 * Notes:
 * - 只有符合 NNN_name.sql 规则的编号 migration 才是数据库契约的权威历史。
 */
import { readFile, readdir } from 'node:fs/promises';

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import {
  createDatabasePool,
  createPostgresConnectionString,
  quoteIdentifier,
} from '../infrastructure/postgres.ts';
import { readApiConfigFile } from '../config/env.ts';
import { orderedMigrationFileNames } from './migrationFiles.ts';
import { provisionStarterTemplates } from '../workspace/starter-templates/provisioner.ts';

const config = readApiConfigFile(new URL('../../.env', import.meta.url));
const pool = createDatabasePool(config.database, {
  // 首次部署时 001_rag.sql 负责创建 vector 扩展，连接本身不能预先依赖该类型。
  registerVectorTypes: false,
});
const schema = quoteIdentifier(config.database.schema);

/**
 * 按文件名顺序应用尚未执行的业务迁移，并初始化独立的 LangGraph checkpoint schema。
 * 每个业务迁移独占一个事务，只有 SQL 与迁移记录同时成功后才会提交。
 */
async function migrate() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationUrl = new URL('../../migrations/', import.meta.url);
  const migrations = orderedMigrationFileNames(await readdir(migrationUrl));

  for (const name of migrations) {
    const alreadyApplied = await pool.query(
      `SELECT 1 FROM ${schema}.schema_migrations WHERE name = $1`,
      [name],
    );
    if (alreadyApplied.rowCount) continue;

    const sql = await readFile(new URL(name, migrationUrl), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path TO ${schema}, public`);
      await client.query(sql);
      await client.query(`INSERT INTO ${schema}.schema_migrations (name) VALUES ($1)`, [name]);
      await client.query('COMMIT');
      console.log(`Applied migration ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await pool.query(
    `INSERT INTO ${schema}.tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [config.rag.tenantId, 'EchoWave 开发租户'],
  );
  await provisionStarterTemplates(pool, config.database.schema, config.rag.tenantId);

  const checkpointer = PostgresSaver.fromConnString(
    createPostgresConnectionString(config.database),
    { schema: config.rag.langGraphSchema },
  );
  await checkpointer.setup();
  console.log(`Initialized LangGraph schema ${config.rag.langGraphSchema}`);
}

try {
  await migrate();
} finally {
  await pool.end();
}
