/**
 * EchoWave 开发 seed 组合入口。
 *
 * 创建唯一事务并按 workspace catalog、knowledge、workspace links、audio 的顺序调用领域 seed。
 *
 * Responsibilities:
 * - 加载本地 API 配置并创建数据库连接。
 * - 统一提交、回滚和释放 seed 事务。
 *
 * Notes:
 * - 仅用于本地开发；运行前必须先显式执行数据库迁移。
 */
import { readApiConfigFile } from '../config/env.ts';
import { createDatabasePool, quoteIdentifier } from '../infrastructure/postgres.ts';
import { seedAudioWorkspace } from './seed/audio.ts';
import { seedKnowledgeCatalog } from './seed/knowledge.ts';
import type { SeedContext } from './seed/types.ts';
import { seedWorkspaceCatalog, seedWorkspaceLinks } from './seed/workspace.ts';

const config = readApiConfigFile(new URL('../../.env', import.meta.url));
const pool = createDatabasePool(config.database);
const schema = quoteIdentifier(config.database.schema);
const context: SeedContext = {
  tenantId: config.rag.tenantId,
  table: (name) => `${schema}.${quoteIdentifier(name)}`,
};

/** 在单个事务中按依赖顺序写入全部开发演示数据。 */
async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedWorkspaceCatalog(client, context);
    await seedKnowledgeCatalog(client, context);
    await seedWorkspaceLinks(client, context);
    await seedAudioWorkspace(client, context);
    await client.query('COMMIT');
    console.log('Seeded EchoWave audio workspace development data.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

try {
  await seed();
} finally {
  await pool.end();
}
