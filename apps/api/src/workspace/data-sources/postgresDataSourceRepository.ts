/**
 * 数据源 PostgreSQL Repository。
 *
 * 负责数据源生命周期、分组关联、上传批次发布和数据源视角音频投影。
 *
 * Responsibilities:
 * - 管理数据源与分组关系。
 * - 在事务中发布上传批次及音频元数据。
 * - 返回数据源详情、音频和执行记录。
 *
 * Notes:
 * - 文件可靠写入发生在 Service，Repository 只发布已写入元数据。
 */
import {
  AudioFileListResponseSchema,
  DataSourceAudioUploadResponseSchema,
  DataSourceDetailSchema,
  DataSourceIngestionListResponseSchema,
  DataSourceListResponseSchema,
  LinkedDataSourceGroupListResponseSchema,
  type DataSourceCreateRequest,
  type DataSourceGroupLinkRequest,
  type DataSourceUpdateRequest,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import { audioItem, integer, iso } from '../audio/core/projection.ts';
import type { GroupRepository } from '../groups/repository.ts';
import { WorkspaceRepositoryError } from '../errors.ts';
import type { DataSourceRepository, StoredAudioUpload } from './repository.ts';

/** 为当前租户实现数据源持久化端口。 */
export class PostgresDataSourceRepository implements DataSourceRepository {
  private readonly schema: string;

  constructor(
    private readonly pool: DatabasePool,
    schema: string,
    private readonly tenantId: string,
    private readonly groupCatalog: Pick<GroupRepository, 'listGroups'>,
  ) {
    this.schema = quoteIdentifier(schema);
  }

  private table(name: string): string {
    return `${this.schema}.${quoteIdentifier(name)}`;
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
  async createDataSource(input: DataSourceCreateRequest) {
    const result = await this.pool.query(
      `INSERT INTO ${this.table('data_sources')}
         (tenant_id, name, description, source_type, location, connection_label,
          connection_status, transcription_model)
       VALUES ($1, $2, $3, 'manual_upload', 'local', '本地手动上传',
                'connected', 'qwen-audio-3.0-asr-flash-filetrans')
       RETURNING id`,
      [this.tenantId, input.name, input.description],
    );
    return this.getDataSource(String(result.rows[0].id));
  }

  /** 更新数据源展示字段与后置角色识别允许使用的自定义角色。 */
  async updateDataSource(dataSourceId: string, input: DataSourceUpdateRequest) {
    const result = await this.pool.query(
      `UPDATE ${this.table('data_sources')}
       SET name = coalesce($3, name), description = coalesce($4, description),
           custom_business_roles = coalesce($5::jsonb, custom_business_roles), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [
        this.tenantId,
        dataSourceId,
        input.name ?? null,
        input.description ?? null,
        input.customBusinessRoles === undefined ? null : JSON.stringify(input.customBusinessRoles),
      ],
    );
    if (!result.rowCount) {
      throw new WorkspaceRepositoryError('NOT_FOUND', '数据源不存在或已归档。');
    }
    return this.getDataSource(dataSourceId);
  }

  /** 软归档活动数据源，保留关联、音频事实和存储键供未来恢复。 */
  async archiveDataSource(dataSourceId: string) {
    const result = await this.pool.query(
      `UPDATE ${this.table('data_sources')}
       SET deleted_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [this.tenantId, dataSourceId],
    );
    if (!result.rowCount) {
      throw new WorkspaceRepositoryError('NOT_FOUND', '数据源不存在或已归档。');
    }
  }

  /** 在事务中验证并幂等关联多个活动分组。 */
  async linkDataSourceGroups(dataSourceId: string, input: DataSourceGroupLinkRequest) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const source = await client.query(
        `SELECT id FROM ${this.table('data_sources')}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR SHARE`,
        [this.tenantId, dataSourceId],
      );
      if (!source.rowCount) {
        throw new WorkspaceRepositoryError('NOT_FOUND', '数据源不存在或已归档。');
      }
      const groups = await client.query(
        `SELECT id FROM ${this.table('groups')}
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL FOR SHARE`,
        [this.tenantId, input.groupIds],
      );
      if (groups.rows.length !== input.groupIds.length) {
        throw new WorkspaceRepositoryError('NOT_FOUND', '一个或多个分组不存在或已归档。');
      }
      await client.query(
        `INSERT INTO ${this.table('group_data_sources')} (tenant_id, group_id, data_source_id)
         SELECT $1, requested.group_id, $2
         FROM unnest($3::uuid[]) AS requested(group_id)
         ON CONFLICT (tenant_id, group_id, data_source_id) DO NOTHING`,
        [this.tenantId, dataSourceId, input.groupIds],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.listDataSourceGroups(dataSourceId);
  }

  /** 校验目标数据源后，原子替换分组的全部数据源关联。 */
  async unlinkDataSourceGroup(dataSourceId: string, groupId: string) {
    const result = await this.pool.query(
      `DELETE FROM ${this.table('group_data_sources')} gds
       WHERE gds.tenant_id = $1 AND gds.data_source_id = $2 AND gds.group_id = $3
         AND EXISTS (
           SELECT 1 FROM ${this.table('data_sources')} ds
           WHERE ds.tenant_id = gds.tenant_id AND ds.id = gds.data_source_id
             AND ds.deleted_at IS NULL
         )
         AND EXISTS (
           SELECT 1 FROM ${this.table('groups')} g
           WHERE g.tenant_id = gds.tenant_id AND g.id = gds.group_id AND g.deleted_at IS NULL
         )
       RETURNING gds.group_id`,
      [this.tenantId, dataSourceId, groupId],
    );
    if (!result.rowCount) {
      throw new WorkspaceRepositoryError('NOT_FOUND', '数据源与分组的关联不存在。');
    }
  }

  /** 原子发布一次成功上传批次及其全部音频元数据。 */
  async createDataSourceAudioUpload(dataSourceId: string, items: StoredAudioUpload[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const source = await client.query(
        `SELECT id FROM ${this.table('data_sources')}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR SHARE`,
        [this.tenantId, dataSourceId],
      );
      if (!source.rowCount) {
        throw new WorkspaceRepositoryError('NOT_FOUND', '数据源不存在或已归档。');
      }
      const run = await client.query(
        `INSERT INTO ${this.table('data_source_ingestion_runs')}
           (tenant_id, data_source_id, trigger_kind, status, completed_at)
         VALUES ($1, $2, 'manual', 'succeeded', now()) RETURNING id`,
        [this.tenantId, dataSourceId],
      );
      const ingestionRunId = String(run.rows[0].id);
      const uploaded = [];
      for (const item of items) {
        const audio = await client.query(
          `INSERT INTO ${this.table('audio_files')}
             (tenant_id, data_source_id, ingestion_run_id, title, original_filename,
              mime_type, size_bytes, duration_ms, storage_key, upload_status, upload_progress)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ready', 100)
           RETURNING id, title, duration_ms, created_at`,
          [
            this.tenantId,
            dataSourceId,
            ingestionRunId,
            item.title,
            item.originalFilename,
            item.mimeType,
            item.sizeBytes,
            item.durationMs,
            item.storageKey,
          ],
        );
        uploaded.push({
          id: audio.rows[0].id,
          sourceId: dataSourceId,
          title: audio.rows[0].title,
          durationMs:
            audio.rows[0].duration_ms === null ? null : integer(audio.rows[0].duration_ms),
          createdAt: iso(audio.rows[0].created_at),
          sharedFrom: null,
          status: { kind: 'waiting' as const },
          hasTranscript: false,
        });
      }
      await client.query(
        `UPDATE ${this.table('data_sources')} SET updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, dataSourceId],
      );
      const response = DataSourceAudioUploadResponseSchema.parse({
        ingestionRunId,
        items: uploaded,
      });
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 软归档指定数据源中的活动音频，不物理删除本地文件。 */
  async archiveDataSourceAudioFile(dataSourceId: string, audioFileId: string) {
    const processing = await this.pool.query(
      `SELECT 1 FROM ${this.table('audio_analysis_revisions')}
       WHERE tenant_id = $1 AND audio_file_id = $2
         AND status IN ('queued', 'transcribing', 'analyzing') LIMIT 1`,
      [this.tenantId, audioFileId],
    );
    if (processing.rowCount) {
      throw new WorkspaceRepositoryError('CONFLICT', '音频正在转写，完成或失败后才能归档。');
    }
    const result = await this.pool.query(
      `UPDATE ${this.table('audio_files')} af
       SET deleted_at = now(), updated_at = now()
       WHERE af.tenant_id = $1 AND af.data_source_id = $2 AND af.id = $3
         AND af.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM ${this.table('data_sources')} ds
           WHERE ds.tenant_id = af.tenant_id AND ds.id = af.data_source_id
             AND ds.deleted_at IS NULL
         )
       RETURNING af.id`,
      [this.tenantId, dataSourceId, audioFileId],
    );
    if (!result.rowCount) {
      throw new WorkspaceRepositoryError('NOT_FOUND', '音频不存在或已归档。');
    }
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
        customBusinessRoles: row.custom_business_roles,
      },
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
       LEFT JOIN LATERAL (
         SELECT CASE
                  WHEN bundled.status = 'failed' THEN 'failed'
                  WHEN ar.status = 'ready'
                   AND af.runtime_mode = 'lightweight_local'
                   AND ar.processing_checkpoint <> 'cleanup_completed'
                    THEN 'analyzing'
                  ELSE ar.status
                END AS status,
                CASE
                  WHEN ar.status = 'ready' AND ar.processing_checkpoint = 'transcript_published'
                    THEN 75 + coalesce(round(bundled.progress * 0.22)::integer, 0)
                  WHEN ar.status = 'ready'
                   AND ar.processing_checkpoint = 'acoustic_emotion_completed' THEN 99
                  ELSE ar.progress
                END AS progress,
                CASE WHEN bundled.status = 'failed' THEN 'analysis'
                  ELSE ar.error_stage END AS error_stage,
                CASE WHEN bundled.status = 'failed' THEN bundled.error_code
                  ELSE ar.error_code END AS error_code,
                CASE WHEN bundled.status = 'failed' THEN bundled.error_message
                  ELSE ar.error_message END AS error_message,
                CASE WHEN bundled.status = 'failed' THEN bundled.error_retryable
                  ELSE ar.error_retryable END AS error_retryable,
                CASE WHEN bundled.status = 'failed' THEN NULL
                  ELSE ar.error_details END AS error_details,
                CASE WHEN active_emotion.status = 'ready' OR bundled.status = 'ready'
                  THEN true ELSE false END AS acoustic_emotion_ready,
                ar.processing_stage, ar.current_chunk,
                ar.chunk_count, ar.current_chunk_start_ms, ar.current_chunk_end_ms,
                ar.network_attempt, ar.structure_attempt, ar.processing_updated_at
         FROM ${this.table('audio_analysis_revisions')} ar
         LEFT JOIN ${this.table('audio_post_analysis_jobs')} bundled
           ON bundled.tenant_id = ar.tenant_id AND bundled.id = ar.bundled_emotion_job_id
         LEFT JOIN ${this.table('audio_post_analysis_jobs')} active_emotion
           ON active_emotion.tenant_id = ar.tenant_id AND active_emotion.id = ar.active_emotion_job_id
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
    const groups = await this.groupCatalog.listGroups();
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
}
