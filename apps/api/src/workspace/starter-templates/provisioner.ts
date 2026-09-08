/**
 * 起步分组模板安装器。
 *
 * 为当前租户一次性安装可编辑的销售复盘、个人表达分组和共享上传数据源。
 *
 * Responsibilities:
 * - 以目录版本标记保证租户内仅安装一次。
 * - 在同一事务中写入分组、分析设置、数据源及关联。
 *
 * Notes:
 * - 重复运行不会恢复用户已归档、改名或解除关联的模板。
 */
import type { PoolClient } from 'pg';

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';

export const STARTER_TEMPLATE_CATALOG_VERSION = 1;

const templates = [
  {
    key: 'sales_call_review',
    name: '销售通话复盘',
    focus:
      '围绕客户需求识别、提问质量、价值表达、异议处理、成交信号与下一步行动复盘销售通话；分别列出有效话术、错失机会、风险和可执行改进建议，并为每项结论引用对应转写证据。',
    tone: '专业、直接、可执行',
    tags: ['需求探索', '价值表达', '异议处理', '成交信号', '跟进动作'],
  },
  {
    key: 'personal_speaking_coach',
    name: '个人表达教练',
    focus:
      '从结构完整性、信息清晰度、语言简洁度、语速节奏、口头禅、情绪感染力和听众理解成本分析自我介绍或演讲；指出亮点、问题片段和可直接练习的改写或表达建议，并引用对应转写证据。',
    tone: '清晰、鼓励、具体',
    tags: ['结构完整', '表达清晰', '语速节奏', '口头禅', '感染力'],
  },
] as const;

/** 在已开启事务的 client 中写入起步目录。 */
async function installCatalog(client: PoolClient, schema: string, tenantId: string): Promise<void> {
  const table = (name: string) => `${schema}.${quoteIdentifier(name)}`;
  const marker = await client.query(
    `INSERT INTO ${table('starter_template_installations')} (tenant_id, catalog_version)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id, catalog_version) DO NOTHING
     RETURNING catalog_version`,
    [tenantId, STARTER_TEMPLATE_CATALOG_VERSION],
  );
  if (!marker.rowCount) return;

  const source = await client.query(
    `INSERT INTO ${table('data_sources')}
       (tenant_id, name, description, source_type, location, connection_label,
        connection_status, transcription_model, custom_business_roles, starter_template_key)
     VALUES ($1, '快速录音上传', '用于向预置模板分组上传销售通话、自我介绍和演讲录音。',
             'manual_upload', 'local', '本地手动上传', 'connected',
             'qwen-audio-3.0-asr-flash-filetrans', $2::jsonb, 'starter_audio_upload')
     RETURNING id`,
    [tenantId, JSON.stringify(['演讲者', '主持人'])],
  );
  const sourceId = String(source.rows[0].id);

  for (const template of templates) {
    const group = await client.query(
      `INSERT INTO ${table('groups')} (tenant_id, name, starter_template_key)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [tenantId, template.name, template.key],
    );
    const groupId = String(group.rows[0].id);
    await client.query(
      `INSERT INTO ${table('group_analysis_settings')}
         (tenant_id, group_id, analysis_timing, content_focus, tone, custom_tags)
       VALUES ($1, $2, 'automatic', $3, $4, $5::jsonb)`,
      [tenantId, groupId, template.focus, template.tone, JSON.stringify(template.tags)],
    );
    await client.query(
      `INSERT INTO ${table('group_data_sources')} (tenant_id, group_id, data_source_id)
       VALUES ($1, $2, $3)`,
      [tenantId, groupId, sourceId],
    );
  }
}

/** 幂等安装当前租户的 v1 起步分组目录。 */
export async function provisionStarterTemplates(
  pool: DatabasePool,
  schemaName: string,
  tenantId: string,
): Promise<void> {
  const client = await pool.connect();
  const schema = quoteIdentifier(schemaName);
  try {
    await client.query('BEGIN');
    await installCatalog(client, schema, tenantId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
