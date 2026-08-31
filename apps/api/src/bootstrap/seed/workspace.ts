/**
 * 工作区目录开发 seed。
 *
 * 写入分组、数据源和二者关联，保持 knowledge 与 audio 样例由各自模块负责。
 *
 * Responsibilities:
 * - 幂等写入分组与数据源目录。
 * - 幂等写入分组和数据源关联。
 *
 * Notes:
 * - 事务与调用顺序由 seed 入口统一管理。
 */
import type { PoolClient } from 'pg';

import { seedIds, type SeedContext } from './types.ts';

/** 写入分组与数据源目录事实。 */
export async function seedWorkspaceCatalog(
  client: PoolClient,
  context: SeedContext,
): Promise<void> {
  const { table, tenantId } = context;
  const ids = seedIds;
  const groups = [
    [ids.groups[0], '产品研究组'],
    [ids.groups[1], '客户体验组'],
    [ids.groups[2], '市场洞察组'],
  ] as const;
  for (const group of groups) {
    await client.query(
      `INSERT INTO ${table('groups')} (id, tenant_id, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now(), deleted_at = NULL`,
      [group[0], tenantId, group[1]],
    );
  }

  const sources = [
    [
      ids.sources[0],
      '团队录音空间',
      '汇集团队访谈、周会与客户沟通录音。',
      'manual_upload',
      'local',
      'HTTPS API / team-audio',
    ],
    [
      ids.sources[1],
      '用户研究云盘',
      '同步研究项目中的访谈音频与观察记录。',
      'cloud_drive',
      'cloud',
      'Cloud Drive / research',
    ],
    [
      ids.sources[2],
      '客户沟通归档',
      '接入客户成功团队的沟通录音。',
      's3',
      'cloud',
      'S3 / customer-calls',
    ],
    [
      ids.sources[3],
      '市场调研资料',
      '整理市场活动与竞品调研录音。',
      'local_folder',
      'local',
      'Local Folder / market',
    ],
  ] as const;
  for (const source of sources) {
    await client.query(
      `INSERT INTO ${table('data_sources')}
           (id, tenant_id, name, description, source_type, location, connection_label,
            connection_status, transcription_model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'connected', 'qwen-audio-3.0-asr-flash-filetrans')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
           source_type = EXCLUDED.source_type, location = EXCLUDED.location,
           connection_label = EXCLUDED.connection_label, updated_at = now(), deleted_at = NULL`,
      [source[0], tenantId, ...source.slice(1)],
    );
  }
}

/** 写入分组与数据源关系。 */
export async function seedWorkspaceLinks(client: PoolClient, context: SeedContext): Promise<void> {
  const { table, tenantId } = context;
  const ids = seedIds;
  const sourceLinks = [
    [ids.groups[0], ids.sources[0]],
    [ids.groups[0], ids.sources[1]],
    [ids.groups[1], ids.sources[0]],
    [ids.groups[1], ids.sources[2]],
    [ids.groups[2], ids.sources[0]],
    [ids.groups[2], ids.sources[3]],
  ];
  for (const link of sourceLinks) {
    await client.query(
      `INSERT INTO ${table('group_data_sources')} (tenant_id, group_id, data_source_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [tenantId, ...link],
    );
  }
}
