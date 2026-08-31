/**
 * 知识库目录开发 seed。
 *
 * 只负责知识库样例和知识库与分组关系，不写入工作区或音频事实。
 *
 * Responsibilities:
 * - 幂等写入演示知识库。
 * - 建立演示知识库与产品研究组关联。
 *
 * Notes:
 * - 事务边界由 seed 入口统一管理。
 */
import type { PoolClient } from 'pg';

import { seedIds, type SeedContext } from './types.ts';

/** 写入演示知识库及其分组关系。 */
export async function seedKnowledgeCatalog(
  client: PoolClient,
  context: SeedContext,
): Promise<void> {
  const { table, tenantId } = context;
  const ids = seedIds;
  await client.query(
    `INSERT INTO ${table('knowledge_bases')} (id, tenant_id, name, description)
       VALUES ($1, $2, '产品研究知识库', '沉淀访谈、研究计划和可追溯证据。')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
         updated_at = now(), deleted_at = NULL`,
    [ids.knowledgeBase, tenantId],
  );
  await client.query(
    `INSERT INTO ${table('group_knowledge_bases')} (tenant_id, group_id, knowledge_base_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [tenantId, ids.groups[0], ids.knowledgeBase],
  );
}
