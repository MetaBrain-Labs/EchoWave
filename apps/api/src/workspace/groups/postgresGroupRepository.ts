/**
 * 分组 PostgreSQL Repository。
 *
 * 负责分组生命周期、资源关联和分组视角投影，所有查询均限定在固定租户内。
 *
 * Responsibilities:
 * - 管理分组、分组设置及知识库和数据源关联。
 * - 构造分组可见音频与实时指标。
 *
 * Notes:
 * - 不处理文件系统、音频任务和 HTTP 协议。
 */
import {
  AudioFileListResponseSchema,
  DataSourceListResponseSchema,
  GroupDetailSchema,
  GroupListResponseSchema,
  GroupSettingsSchema,
  DEFAULT_GROUP_ANALYSIS_FOCUS,
  DEFAULT_GROUP_ANALYSIS_TONE,
  KnowledgeBaseListResponseSchema,
  type GroupCreateRequest,
  type GroupResourceLinksUpdateRequest,
  type GroupSettingsUpdateRequest,
  type KnowledgeBaseGroupLinkRequest,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import { audioItem, integer, iso, scopedVisibleAudioCte } from '../audio/core/projection.ts';
import { WorkspaceRepositoryError } from '../errors.ts';
import type { GroupRepository } from './repository.ts';

/** 为当前租户实现分组持久化端口。 */
export class PostgresGroupRepository implements GroupRepository {
  private readonly schema: string;

  constructor(
    private readonly pool: DatabasePool,
    schema: string,
    private readonly tenantId: string,
  ) {
    this.schema = quoteIdentifier(schema);
  }

  private table(name: string): string {
    return `${this.schema}.${quoteIdentifier(name)}`;
  }

  private scopedVisibleAudioCte(): string {
    return scopedVisibleAudioCte((name) => this.table(name));
  }

  async listGroups() {
    const result = await this.pool.query(
      `WITH ${this.scopedVisibleAudioCte()},
       group_audio_stats AS (
         SELECT va.group_id,
                count(DISTINCT af.id)::int AS audio_count,
                count(DISTINCT af.active_analysis_revision_id)
                  FILTER (WHERE ar.status = 'ready')::int AS analysis_count
         FROM visible_audio va
         JOIN ${this.table('audio_files')} af
           ON af.tenant_id = va.tenant_id AND af.id = va.audio_file_id AND af.deleted_at IS NULL
         LEFT JOIN ${this.table('audio_analysis_revisions')} ar
           ON ar.tenant_id = af.tenant_id AND ar.id = af.active_analysis_revision_id
         WHERE va.tenant_id = $1
         GROUP BY va.group_id
       )
       SELECT g.id, g.name, g.updated_at,
              coalesce(gas.analysis_count, 0)::int AS analysis_count,
              coalesce(gas.audio_count, 0)::int AS audio_count,
              count(DISTINCT gkb.knowledge_base_id)::int AS knowledge_count,
              count(DISTINCT linked_source.id)::int AS source_count
       FROM ${this.table('groups')} g
       LEFT JOIN group_audio_stats gas ON gas.group_id = g.id
       LEFT JOIN ${this.table('group_knowledge_bases')} gkb
         ON gkb.tenant_id = g.tenant_id AND gkb.group_id = g.id
       LEFT JOIN ${this.table('group_data_sources')} gds
         ON gds.tenant_id = g.tenant_id AND gds.group_id = g.id
       LEFT JOIN ${this.table('data_sources')} linked_source
         ON linked_source.tenant_id = gds.tenant_id AND linked_source.id = gds.data_source_id
        AND linked_source.deleted_at IS NULL
       WHERE g.tenant_id = $1 AND g.deleted_at IS NULL
       GROUP BY g.id, gas.analysis_count, gas.audio_count
       ORDER BY g.updated_at DESC`,
      [this.tenantId],
    );
    return GroupListResponseSchema.parse({
      items: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        metrics: {
          analysisCount: row.analysis_count,
          audioCount: row.audio_count,
          knowledgeCount: row.knowledge_count,
          sourceCount: row.source_count,
        },
        updatedAt: iso(row.updated_at),
      })),
    });
  }

  async getGroup(groupId: string) {
    const groups = await this.listGroups();
    const group = groups.items.find((item) => item.id === groupId);
    if (!group) throw new WorkspaceRepositoryError('NOT_FOUND', '分组不存在。');
    return GroupDetailSchema.parse(group);
  }

  /** 读取分组名称与分析配置；旧分组尚无设置行时返回产品默认值。 */
  async getGroupSettings(groupId: string) {
    const result = await this.pool.query(
      `SELECT g.id, g.name, g.updated_at, coalesce(s.analysis_timing, 'automatic') AS analysis_timing,
              coalesce(s.content_focus, $3) AS content_focus,
              coalesce(s.tone, $4) AS tone, coalesce(s.custom_tags, '[]'::jsonb) AS custom_tags
       FROM ${this.table('groups')} g
       LEFT JOIN ${this.table('group_analysis_settings')} s
         ON s.tenant_id = g.tenant_id AND s.group_id = g.id
       WHERE g.tenant_id = $1 AND g.id = $2 AND g.deleted_at IS NULL`,
      [this.tenantId, groupId, DEFAULT_GROUP_ANALYSIS_FOCUS, DEFAULT_GROUP_ANALYSIS_TONE],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '分组不存在。');
    return GroupSettingsSchema.parse({
      groupId: row.id,
      name: row.name,
      analysis: {
        timing: row.analysis_timing,
        contentFocus: row.content_focus,
        tone: row.tone,
        customTags: row.custom_tags,
      },
      updatedAt: iso(row.updated_at),
    });
  }

  /** 原子保存分组名称与完整分析设置。 */
  async updateGroupSettings(groupId: string, input: GroupSettingsUpdateRequest) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const group = await client.query(
        `UPDATE ${this.table('groups')}
         SET name = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [this.tenantId, groupId, input.name],
      );
      if (!group.rowCount) throw new WorkspaceRepositoryError('NOT_FOUND', '分组不存在。');
      await client.query(
        `INSERT INTO ${this.table('group_analysis_settings')}
           (tenant_id, group_id, analysis_timing, content_focus, tone, custom_tags, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
         ON CONFLICT (tenant_id, group_id) DO UPDATE
         SET analysis_timing = excluded.analysis_timing,
             content_focus = excluded.content_focus,
             tone = excluded.tone,
             custom_tags = excluded.custom_tags,
             updated_at = now()`,
        [
          this.tenantId,
          groupId,
          input.analysis.timing,
          input.analysis.contentFocus,
          input.analysis.tone,
          JSON.stringify(input.analysis.customTags),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.getGroupSettings(groupId);
  }

  /** 在当前租户下创建空分组，并返回与列表一致的零指标投影。 */
  async createGroup(input: GroupCreateRequest) {
    const result = await this.pool.query(
      `INSERT INTO ${this.table('groups')} (tenant_id, name)
       VALUES ($1, $2)
       RETURNING id, name, updated_at`,
      [this.tenantId, input.name],
    );
    const row = result.rows[0];
    return GroupDetailSchema.parse({
      id: row.id,
      name: row.name,
      metrics: { analysisCount: 0, audioCount: 0, knowledgeCount: 0, sourceCount: 0 },
      updatedAt: iso(row.updated_at),
    });
  }

  /** 软归档当前租户内尚未归档的分组，保留关联事实供未来恢复。 */
  async archiveGroup(groupId: string) {
    const result = await this.pool.query(
      `UPDATE ${this.table('groups')}
       SET deleted_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [this.tenantId, groupId],
    );
    if (!result.rowCount) {
      throw new WorkspaceRepositoryError('NOT_FOUND', '分组不存在或已归档。');
    }
  }

  async listGroupAudioFiles(groupId: string) {
    await this.getGroup(groupId);
    const result = await this.pool.query(
      `SELECT af.*, origin.name AS shared_from,
              latest.status AS analysis_status, latest.progress AS analysis_progress,
              latest.error_stage AS analysis_error_stage,
              latest.error_code AS analysis_error_code,
              latest.error_message AS analysis_error_message,
              latest.error_retryable AS analysis_error_retryable,
              latest.error_details AS analysis_error_details,
              latest.processing_stage AS analysis_processing_stage,
              latest.current_chunk AS analysis_current_chunk,
              latest.chunk_count AS analysis_chunk_count,
              latest.current_chunk_start_ms AS analysis_current_chunk_start_ms,
              latest.current_chunk_end_ms AS analysis_current_chunk_end_ms,
              latest.network_attempt AS analysis_network_attempt,
              latest.structure_attempt AS analysis_structure_attempt,
              latest.processing_updated_at AS analysis_processing_updated_at,
              af.error_code AS audio_error_code,
              af.error_message AS audio_error_message,
              af.error_retryable AS audio_error_retryable
       FROM ${this.table('audio_files')} af
       LEFT JOIN ${this.table('groups')} origin
         ON origin.tenant_id = af.tenant_id AND origin.id = af.origin_group_id
       LEFT JOIN LATERAL (
         SELECT ar.status, ar.progress, ar.error_stage, ar.error_code, ar.error_message,
                ar.error_retryable, ar.error_details, ar.processing_stage, ar.current_chunk,
                ar.chunk_count, ar.current_chunk_start_ms, ar.current_chunk_end_ms,
                ar.network_attempt, ar.structure_attempt, ar.processing_updated_at
         FROM ${this.table('audio_analysis_revisions')} ar
         WHERE ar.tenant_id = af.tenant_id AND ar.audio_file_id = af.id
         ORDER BY ar.revision_no DESC LIMIT 1
       ) latest ON true
       WHERE af.tenant_id = $1 AND af.deleted_at IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM ${this.table('group_audio_links')} gal
             WHERE gal.tenant_id = af.tenant_id AND gal.group_id = $2 AND gal.audio_file_id = af.id
           )
            OR EXISTS (
              SELECT 1 FROM ${this.table('group_data_sources')} gds
              JOIN ${this.table('data_sources')} ds
                ON ds.tenant_id = gds.tenant_id AND ds.id = gds.data_source_id
               AND ds.deleted_at IS NULL
              WHERE gds.tenant_id = af.tenant_id AND gds.group_id = $2
                AND gds.data_source_id = af.data_source_id
           )
         )
       ORDER BY af.created_at DESC`,
      [this.tenantId, groupId],
    );
    return AudioFileListResponseSchema.parse({
      items: result.rows.map((row) =>
        audioItem({
          ...row,
          shared_from:
            row.origin_group_id && row.origin_group_id !== groupId ? row.shared_from : null,
        }),
      ),
    });
  }

  async listGroupKnowledgeBases(groupId: string) {
    await this.getGroup(groupId);
    const result = await this.pool.query(
      `SELECT kb.id, kb.name, kb.description, kb.updated_at,
              count(DISTINCT d.id)::int AS document_count,
              count(DISTINCT all_links.group_id)::int AS linked_group_count
       FROM ${this.table('group_knowledge_bases')} requested
       JOIN ${this.table('knowledge_bases')} kb
         ON kb.tenant_id = requested.tenant_id AND kb.id = requested.knowledge_base_id
       LEFT JOIN ${this.table('documents')} d
         ON d.tenant_id = kb.tenant_id AND d.knowledge_base_id = kb.id AND d.deleted_at IS NULL
       LEFT JOIN ${this.table('group_knowledge_bases')} all_links
         ON all_links.tenant_id = kb.tenant_id AND all_links.knowledge_base_id = kb.id
       WHERE requested.tenant_id = $1 AND requested.group_id = $2 AND kb.deleted_at IS NULL
       GROUP BY kb.id
       ORDER BY kb.updated_at DESC`,
      [this.tenantId, groupId],
    );
    return KnowledgeBaseListResponseSchema.parse({
      items: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        documentCount: row.document_count,
        linkedGroupCount: row.linked_group_count,
        updatedAt: iso(row.updated_at),
      })),
    });
  }

  /** 校验目标知识库后，原子替换分组的全部知识库关联。 */
  async replaceGroupKnowledgeBases(groupId: string, input: GroupResourceLinksUpdateRequest) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const group = await client.query(
        `SELECT id FROM ${this.table('groups')}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [this.tenantId, groupId],
      );
      if (!group.rowCount) throw new WorkspaceRepositoryError('NOT_FOUND', '分组不存在。');
      const resources = await client.query(
        `SELECT id FROM ${this.table('knowledge_bases')}
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL FOR SHARE`,
        [this.tenantId, input.ids],
      );
      if (resources.rows.length !== input.ids.length) {
        throw new WorkspaceRepositoryError('NOT_FOUND', '一个或多个知识库不存在。');
      }
      await client.query(
        `DELETE FROM ${this.table('group_knowledge_bases')}
         WHERE tenant_id = $1 AND group_id = $2`,
        [this.tenantId, groupId],
      );
      await client.query(
        `INSERT INTO ${this.table('group_knowledge_bases')} (tenant_id, group_id, knowledge_base_id)
         SELECT $1, $2, requested.id FROM unnest($3::uuid[]) requested(id)`,
        [this.tenantId, groupId, input.ids],
      );
      await client.query(
        `UPDATE ${this.table('groups')} SET updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, groupId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.listGroupKnowledgeBases(groupId);
  }

  /** 返回知识库当前关联的全部未归档分组及其实时指标。 */
  async listKnowledgeBaseGroups(knowledgeBaseId: string) {
    const knowledge = await this.pool.query(
      `SELECT id FROM ${this.table('knowledge_bases')}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [this.tenantId, knowledgeBaseId],
    );
    if (!knowledge.rowCount) {
      throw new WorkspaceRepositoryError('NOT_FOUND', '知识库不存在。');
    }
    const groups = await this.listGroups();
    const links = await this.pool.query(
      `SELECT group_id FROM ${this.table('group_knowledge_bases')}
       WHERE tenant_id = $1 AND knowledge_base_id = $2`,
      [this.tenantId, knowledgeBaseId],
    );
    const linkedIds = new Set(links.rows.map((row) => String(row.group_id)));
    return GroupListResponseSchema.parse({
      items: groups.items.filter((group) => linkedIds.has(group.id)),
    });
  }

  /** 在单个事务中校验并幂等建立知识库与多个活动分组的关系。 */
  async linkKnowledgeBaseGroups(knowledgeBaseId: string, input: KnowledgeBaseGroupLinkRequest) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const knowledge = await client.query(
        `SELECT id FROM ${this.table('knowledge_bases')}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         FOR SHARE`,
        [this.tenantId, knowledgeBaseId],
      );
      if (!knowledge.rowCount) {
        throw new WorkspaceRepositoryError('NOT_FOUND', '知识库不存在。');
      }
      const groups = await client.query(
        `SELECT id FROM ${this.table('groups')}
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
         FOR SHARE`,
        [this.tenantId, input.groupIds],
      );
      if (groups.rows.length !== input.groupIds.length) {
        throw new WorkspaceRepositoryError('NOT_FOUND', '一个或多个分组不存在或已归档。');
      }
      await client.query(
        `INSERT INTO ${this.table('group_knowledge_bases')} (tenant_id, group_id, knowledge_base_id)
         SELECT $1, requested.group_id, $2
         FROM unnest($3::uuid[]) AS requested(group_id)
         ON CONFLICT (tenant_id, group_id, knowledge_base_id) DO NOTHING`,
        [this.tenantId, knowledgeBaseId, input.groupIds],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.listKnowledgeBaseGroups(knowledgeBaseId);
  }

  private dataSourceSummary(row: Record<string, any>) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      sourceType: row.source_type,
      location: row.location,
      connectionLabel: row.connection_label,
      connectionStatus: row.connection_status,
      linkedGroupCount: integer(row.linked_group_count),
      lastUploadedAt: row.last_uploaded_at ? iso(row.last_uploaded_at) : null,
    };
  }

  private async dataSourceRows(whereSql = '', values: unknown[] = [this.tenantId]) {
    return this.pool.query(
      `SELECT ds.*,
              coalesce(group_stats.linked_group_count, 0)::int AS linked_group_count,
              uploads.last_uploaded_at,
              coalesce(audio_stats.audio_count, 0)::int AS audio_count,
              coalesce(audio_stats.total_duration_ms, 0)::bigint AS total_duration_ms,
              coalesce(audio_stats.transcribed_count, 0)::int AS transcribed_count
       FROM ${this.table('data_sources')} ds
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS linked_group_count
         FROM ${this.table('group_data_sources')} gds
         JOIN ${this.table('groups')} g
           ON g.tenant_id = gds.tenant_id AND g.id = gds.group_id AND g.deleted_at IS NULL
         WHERE gds.tenant_id = ds.tenant_id AND gds.data_source_id = ds.id
       ) group_stats ON true
       LEFT JOIN LATERAL (
         SELECT max(r.completed_at) AS last_uploaded_at
         FROM ${this.table('data_source_ingestion_runs')} r
         WHERE r.tenant_id = ds.tenant_id AND r.data_source_id = ds.id
           AND r.status IN ('succeeded', 'partial')
       ) uploads ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS audio_count,
                coalesce(sum(af.duration_ms), 0)::bigint AS total_duration_ms,
                count(*) FILTER (WHERE ar.status = 'ready')::int AS transcribed_count
         FROM ${this.table('audio_files')} af
         LEFT JOIN ${this.table('audio_analysis_revisions')} ar
           ON ar.tenant_id = af.tenant_id AND ar.id = af.active_analysis_revision_id
         WHERE af.tenant_id = ds.tenant_id AND af.data_source_id = ds.id AND af.deleted_at IS NULL
       ) audio_stats ON true
       WHERE ds.tenant_id = $1 AND ds.deleted_at IS NULL ${whereSql}
       ORDER BY ds.updated_at DESC`,
      values,
    );
  }

  /** 创建仅支持本地手动上传的空数据源，连接和分析设置使用服务器固定默认值。 */
  async replaceGroupDataSources(groupId: string, input: GroupResourceLinksUpdateRequest) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const group = await client.query(
        `SELECT id FROM ${this.table('groups')}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [this.tenantId, groupId],
      );
      if (!group.rowCount) throw new WorkspaceRepositoryError('NOT_FOUND', '分组不存在。');
      const resources = await client.query(
        `SELECT id FROM ${this.table('data_sources')}
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL FOR SHARE`,
        [this.tenantId, input.ids],
      );
      if (resources.rows.length !== input.ids.length) {
        throw new WorkspaceRepositoryError('NOT_FOUND', '一个或多个数据源不存在。');
      }
      await client.query(
        `DELETE FROM ${this.table('group_data_sources')}
         WHERE tenant_id = $1 AND group_id = $2`,
        [this.tenantId, groupId],
      );
      await client.query(
        `INSERT INTO ${this.table('group_data_sources')} (tenant_id, group_id, data_source_id)
         SELECT $1, $2, requested.id FROM unnest($3::uuid[]) requested(id)`,
        [this.tenantId, groupId, input.ids],
      );
      await client.query(
        `UPDATE ${this.table('groups')} SET updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, groupId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.listGroupDataSources(groupId);
  }

  /** 硬删除单条关系，不影响数据源、分组、音频或显式分享事实。 */
  async listGroupDataSources(groupId: string) {
    await this.getGroup(groupId);
    const result = await this.dataSourceRows(
      `AND EXISTS (
         SELECT 1 FROM ${this.table('group_data_sources')} selected
         WHERE selected.tenant_id = ds.tenant_id AND selected.data_source_id = ds.id
           AND selected.group_id = $2
       )`,
      [this.tenantId, groupId],
    );
    return DataSourceListResponseSchema.parse({
      items: result.rows.map((row) => this.dataSourceSummary(row)),
    });
  }
}
