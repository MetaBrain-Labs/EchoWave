/**
 * 音频工作区仓储。
 *
 * 从分组、数据源、音频及分析结果事实表构建移动端所需投影，并维护分组生命周期；
 * 所有读写均固定在当前租户边界内。
 *
 * Responsibilities:
 * - 聚合分组和数据源动态指标。
 * - 统一推导音频处理状态与上传时间线。
 * - 恢复当前已发布分析版本的有序内容。
 * - 创建并软归档租户内分组。
 *
 * Notes:
 * - 本仓储不创建连接、不保存凭据，也不执行音频处理任务。
 */
import {
  AudioAnalysisDetailSchema,
  AudioFileListResponseSchema,
  DataSourceDetailSchema,
  DataSourceIngestionListResponseSchema,
  DataSourceListResponseSchema,
  GroupDetailSchema,
  GroupListResponseSchema,
  KnowledgeBaseListResponseSchema,
  LinkedDataSourceGroupListResponseSchema,
  type AudioProcessingStatus,
  type GroupCreateRequest,
  type KnowledgeBaseGroupLinkRequest,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import { WorkspaceRepositoryError } from './errors.ts';

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function integer(value: unknown): number {
  return Number(value ?? 0);
}

function audioStatus(row: Record<string, unknown>): AudioProcessingStatus {
  if (row.upload_status === 'uploading') {
    return { kind: 'uploading', progress: integer(row.upload_progress) };
  }
  if (row.upload_status === 'failed') {
    return {
      kind: 'failed',
      stage: 'upload',
      code: String(row.audio_error_code ?? 'UPLOAD_FAILED'),
      message: String(row.audio_error_message ?? '音频上传失败。'),
      retryable: Boolean(row.audio_error_retryable),
    };
  }
  switch (row.analysis_status) {
    case 'transcribing':
      return { kind: 'transcribing', progress: integer(row.analysis_progress) };
    case 'analyzing':
      return { kind: 'analyzing', progress: integer(row.analysis_progress) };
    case 'ready':
      return { kind: 'ready' };
    case 'failed': {
      const stage = row.analysis_error_stage === 'transcription' ? 'transcription' : 'analysis';
      return {
        kind: 'failed',
        stage,
        code: String(row.analysis_error_code ?? 'ANALYSIS_FAILED'),
        message: String(row.analysis_error_message ?? '音频分析失败。'),
        retryable: Boolean(row.analysis_error_retryable),
      };
    }
    default:
      return { kind: 'waiting' };
  }
}

function audioItem(row: Record<string, any>) {
  return {
    id: row.id,
    sourceId: row.data_source_id ?? null,
    title: row.title,
    durationMs: row.duration_ms === null ? null : integer(row.duration_ms),
    createdAt: iso(row.created_at),
    sharedFrom: row.shared_from ?? null,
    status: audioStatus(row),
  };
}

const visibleAudioCte = `
  visible_audio AS (
    SELECT gal.tenant_id, gal.group_id, gal.audio_file_id
    FROM group_audio_links gal
    UNION
    SELECT gds.tenant_id, gds.group_id, af.id
    FROM group_data_sources gds
    JOIN audio_files af
      ON af.tenant_id = gds.tenant_id
     AND af.data_source_id = gds.data_source_id
     AND af.deleted_at IS NULL
  )`;

/** 为当前固定租户提供分组生命周期和音频工作区查询。 */
export class WorkspaceRepository {
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
    return visibleAudioCte
      .replaceAll('group_audio_links', this.table('group_audio_links'))
      .replaceAll('group_data_sources', this.table('group_data_sources'))
      .replaceAll('audio_files', this.table('audio_files'));
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
              count(DISTINCT gds.data_source_id)::int AS source_count
       FROM ${this.table('groups')} g
       LEFT JOIN group_audio_stats gas ON gas.group_id = g.id
       LEFT JOIN ${this.table('group_knowledge_bases')} gkb
         ON gkb.tenant_id = g.tenant_id AND gkb.group_id = g.id
       LEFT JOIN ${this.table('group_data_sources')} gds
         ON gds.tenant_id = g.tenant_id AND gds.group_id = g.id
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
              af.error_code AS audio_error_code,
              af.error_message AS audio_error_message,
              af.error_retryable AS audio_error_retryable
       FROM ${this.table('audio_files')} af
       LEFT JOIN ${this.table('groups')} origin
         ON origin.tenant_id = af.tenant_id AND origin.id = af.origin_group_id
       LEFT JOIN LATERAL (
         SELECT ar.status, ar.progress, ar.error_stage, ar.error_code, ar.error_message, ar.error_retryable
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

  async listDataSources() {
    const result = await this.dataSourceRows();
    return DataSourceListResponseSchema.parse({
      items: result.rows.map((row) => this.dataSourceSummary(row)),
    });
  }

  async getDataSource(dataSourceId: string) {
    const result = await this.dataSourceRows('AND ds.id = $2', [this.tenantId, dataSourceId]);
    const row = result.rows[0];
    if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '数据源不存在。');
    const audioCount = integer(row.audio_count);
    const transcribedCount = integer(row.transcribed_count);
    return DataSourceDetailSchema.parse({
      ...this.dataSourceSummary(row),
      metrics: {
        audioCount,
        totalDurationMs: integer(row.total_duration_ms),
        transcribedCount,
        pendingCount: Math.max(0, audioCount - transcribedCount),
      },
      settings: {
        transcriptionModel: row.transcription_model,
        autoTranscribe: row.auto_transcribe,
        emotionAnalysis: row.emotion_analysis_enabled,
        speakerDiarization: row.speaker_diarization_enabled,
        sceneSegmentation: row.scene_segmentation_enabled,
        skipInvalidAudio: row.skip_invalid_audio,
      },
    });
  }

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

  async listDataSourceAudioFiles(dataSourceId: string) {
    await this.getDataSource(dataSourceId);
    const result = await this.pool.query(
      `SELECT af.*, null::text AS shared_from,
              latest.status AS analysis_status, latest.progress AS analysis_progress,
              latest.error_stage AS analysis_error_stage,
              latest.error_code AS analysis_error_code,
              latest.error_message AS analysis_error_message,
              latest.error_retryable AS analysis_error_retryable,
              af.error_code AS audio_error_code,
              af.error_message AS audio_error_message,
              af.error_retryable AS audio_error_retryable
       FROM ${this.table('audio_files')} af
       LEFT JOIN LATERAL (
         SELECT ar.status, ar.progress, ar.error_stage, ar.error_code, ar.error_message, ar.error_retryable
         FROM ${this.table('audio_analysis_revisions')} ar
         WHERE ar.tenant_id = af.tenant_id AND ar.audio_file_id = af.id
         ORDER BY ar.revision_no DESC LIMIT 1
       ) latest ON true
       WHERE af.tenant_id = $1 AND af.data_source_id = $2 AND af.deleted_at IS NULL
       ORDER BY af.created_at DESC`,
      [this.tenantId, dataSourceId],
    );
    return AudioFileListResponseSchema.parse({ items: result.rows.map(audioItem) });
  }

  async listDataSourceIngestionRecords(dataSourceId: string) {
    await this.getDataSource(dataSourceId);
    const result = await this.pool.query(
      `SELECT r.id,
              CASE WHEN r.status = 'succeeded' THEN 'upload-success' ELSE 'upload-failed' END AS kind,
              coalesce(r.completed_at, r.started_at) AS occurred_at,
              count(DISTINCT af.id)::int AS audio_count,
              coalesce(sum(af.duration_ms), 0)::bigint AS total_duration_ms,
              r.error_code, r.error_message, coalesce(r.error_retryable, false) AS retryable
       FROM ${this.table('data_source_ingestion_runs')} r
       LEFT JOIN ${this.table('audio_files')} af
         ON af.tenant_id = r.tenant_id AND af.ingestion_run_id = r.id AND af.deleted_at IS NULL
       WHERE r.tenant_id = $1 AND r.data_source_id = $2 AND r.status <> 'running'
       GROUP BY r.id
       UNION ALL
       SELECT ar.id, 'transcription-failed' AS kind,
              coalesce(ar.completed_at, ar.created_at) AS occurred_at,
              1::int AS audio_count, coalesce(af.duration_ms, 0)::bigint AS total_duration_ms,
              ar.error_code, ar.error_message, coalesce(ar.error_retryable, false) AS retryable
       FROM ${this.table('audio_analysis_revisions')} ar
       JOIN ${this.table('audio_files')} af
         ON af.tenant_id = ar.tenant_id AND af.id = ar.audio_file_id AND af.deleted_at IS NULL
       WHERE ar.tenant_id = $1 AND af.data_source_id = $2
         AND ar.status = 'failed' AND ar.error_stage = 'transcription'
       ORDER BY occurred_at DESC`,
      [this.tenantId, dataSourceId],
    );
    return DataSourceIngestionListResponseSchema.parse({
      items: result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        occurredAt: iso(row.occurred_at),
        audioCount: integer(row.audio_count),
        totalDurationMs: integer(row.total_duration_ms),
        errorCode: row.error_code ?? null,
        errorMessage: row.error_message ?? null,
        retryable: row.retryable,
      })),
    });
  }

  async listDataSourceGroups(dataSourceId: string) {
    await this.getDataSource(dataSourceId);
    const groups = await this.listGroups();
    const result = await this.pool.query(
      `SELECT group_id FROM ${this.table('group_data_sources')}
       WHERE tenant_id = $1 AND data_source_id = $2`,
      [this.tenantId, dataSourceId],
    );
    const selected = new Set(result.rows.map((row) => row.group_id));
    return LinkedDataSourceGroupListResponseSchema.parse({
      items: groups.items
        .filter((group) => selected.has(group.id))
        .map((group) => ({
          id: group.id,
          name: group.name,
          ...group.metrics,
        })),
    });
  }

  async getAudioAnalysis(audioFileId: string) {
    const head = await this.pool.query(
      `SELECT ar.id, ar.audio_file_id, ar.revision_no, ar.published_at,
              af.title, coalesce(af.duration_ms, 0)::bigint AS duration_ms
       FROM ${this.table('audio_files')} af
       JOIN ${this.table('audio_analysis_revisions')} ar
         ON ar.tenant_id = af.tenant_id AND ar.id = af.active_analysis_revision_id
       WHERE af.tenant_id = $1 AND af.id = $2 AND af.deleted_at IS NULL AND ar.status = 'ready'`,
      [this.tenantId, audioFileId],
    );
    const row = head.rows[0];
    if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '音频分析不存在。');

    const [segments, invalidSegments, summaries] = await Promise.all([
      this.pool.query(
        `SELECT s.id AS scene_id, s.scene_index, s.title AS scene_title, s.start_ms AS scene_start_ms,
                ts.id AS segment_id, ts.segment_index, ts.speaker_key, ts.speaker_label,
                ts.emotion, ts.start_ms, ts.end_ms, ts.text,
                tag.id AS tag_id, tag.title AS tag_title, tag.summary AS tag_summary, tag.details
         FROM ${this.table('analysis_scenes')} s
         LEFT JOIN ${this.table('transcript_segments')} ts
           ON ts.tenant_id = s.tenant_id AND ts.scene_id = s.id
         LEFT JOIN ${this.table('segment_ai_tags')} tag
           ON tag.tenant_id = ts.tenant_id AND tag.transcript_segment_id = ts.id
         WHERE s.tenant_id = $1 AND s.analysis_revision_id = $2
         ORDER BY s.scene_index, ts.segment_index`,
        [this.tenantId, row.id],
      ),
      this.pool.query(
        `SELECT id, start_ms, end_ms, reason
         FROM ${this.table('analysis_invalid_segments')}
         WHERE tenant_id = $1 AND analysis_revision_id = $2 ORDER BY start_ms`,
        [this.tenantId, row.id],
      ),
      this.pool.query(
        `SELECT id, section_index, title, body
         FROM ${this.table('analysis_summary_sections')}
         WHERE tenant_id = $1 AND analysis_revision_id = $2 ORDER BY section_index`,
        [this.tenantId, row.id],
      ),
    ]);

    const scenes = new Map<string, any>();
    for (const item of segments.rows) {
      let scene = scenes.get(item.scene_id);
      if (!scene) {
        scene = {
          id: item.scene_id,
          index: item.scene_index,
          title: item.scene_title,
          startMs: integer(item.scene_start_ms),
          segments: [],
        };
        scenes.set(item.scene_id, scene);
      }
      if (item.segment_id) {
        scene.segments.push({
          id: item.segment_id,
          index: item.segment_index,
          speakerKey: item.speaker_key,
          speakerLabel: item.speaker_label,
          emotion: item.emotion,
          startMs: integer(item.start_ms),
          endMs: integer(item.end_ms),
          text: item.text,
          aiTag: item.tag_id
            ? {
                id: item.tag_id,
                title: item.tag_title,
                summary: item.tag_summary,
                details: item.details,
              }
            : null,
        });
      }
    }

    return AudioAnalysisDetailSchema.parse({
      id: row.id,
      audioFileId: row.audio_file_id,
      revision: row.revision_no,
      title: row.title,
      durationMs: integer(row.duration_ms),
      generatedAt: iso(row.published_at),
      scenes: [...scenes.values()],
      invalidSegments: invalidSegments.rows.map((item) => ({
        id: item.id,
        startMs: integer(item.start_ms),
        endMs: integer(item.end_ms),
        reason: item.reason,
      })),
      summarySections: summaries.rows.map((item) => ({
        id: item.id,
        index: item.section_index,
        title: item.title,
        body: item.body,
      })),
    });
  }
}
