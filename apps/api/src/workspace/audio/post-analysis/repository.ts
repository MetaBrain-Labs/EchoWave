/**
 * 音频后置分析任务仓储。
 *
 * 使用 PostgreSQL 保存情绪分析与角色识别任务，并将成功结果原子发布到对应 ASR 修订；
 * 新任务失败时保留该修订上一次成功发布的结果指针。
 *
 * Responsibilities:
 * - 创建、领取和推进两类独立任务。
 * - 原子保存逐段情绪或逐说话人角色结果。
 * - 隔离失败任务，保持已发布结果可读。
 *
 * Notes:
 * - 音频正文与模型原始输出不写入任务错误字段。
 */
import {
  AudioPostAnalysisStartResponseSchema,
  type AudioPostAnalysisType,
  type SegmentEmotionAnalysis,
  type SegmentRoleAnalysis,
} from '@echowave/contracts';
import type { PoolClient } from 'pg';

import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';
import { WorkspaceRepositoryError } from '../../errors.ts';

export type PostAnalysisTranscriptSegment = {
  id: string;
  speakerKey: string;
  startMs: number;
  endMs: number;
  text: string;
};

/** worker 领取后不可变的后置分析输入快照。 */
export type ClaimedPostAnalysisJob = {
  id: string;
  type: AudioPostAnalysisType;
  model: string;
  audioFileId: string;
  revisionId: string;
  storageKey: string;
  durationMs: number;
  customBusinessRoles: string[];
  confirmationId: string;
  confirmationVersion: number;
  capabilityBindingRevisionId: string | null;
  stagingBindingRevisionId: string | null;
  runtimeMode: 'hybrid' | 'object_storage' | 'lightweight_local';
  storageBackend: 'local_persistent' | 'local_ephemeral' | 'aliyun_oss';
  storageBindingRevisionId: string | null;
  bundled: boolean;
  segments: PostAnalysisTranscriptSegment[];
};

export type EmotionPublication = SegmentEmotionAnalysis & { segmentId: string };
export type RolePublication = SegmentRoleAnalysis & { speakerKey: string };

/** 管理后置分析队列与版本化发布事务。 */
export class PostAnalysisRepository {
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

  /** 为当前已发布 ASR 修订创建独立的后置分析任务。 */
  async queue(
    audioFileId: string,
    type: AudioPostAnalysisType,
    model: string,
    capabilityBindingRevisionId: string | null = null,
    stagingBindingRevisionId: string | null = null,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const source = await client.query(
        `SELECT af.active_analysis_revision_id AS revision_id,
                ar.active_transcript_confirmation_id AS confirmation_id,
                tc.version_no AS confirmation_version,
                coalesce(ds.custom_business_roles, '[]'::jsonb) AS custom_business_roles
         FROM ${this.table('audio_files')} af
         LEFT JOIN ${this.table('data_sources')} ds
           ON ds.tenant_id = af.tenant_id AND ds.id = af.data_source_id
         JOIN ${this.table('audio_analysis_revisions')} ar
           ON ar.tenant_id = af.tenant_id AND ar.id = af.active_analysis_revision_id
         LEFT JOIN ${this.table('transcript_confirmations')} tc
           ON tc.tenant_id = ar.tenant_id AND tc.id = ar.active_transcript_confirmation_id
         WHERE af.tenant_id = $1 AND af.id = $2 AND af.deleted_at IS NULL
           AND ar.status = 'ready' FOR UPDATE OF af`,
        [this.tenantId, audioFileId],
      );
      const row = source.rows[0];
      if (!row) {
        throw new WorkspaceRepositoryError('CONFLICT', '音频尚无已发布转写，无法开始分析。');
      }
      if (!row.confirmation_id) {
        throw new WorkspaceRepositoryError('CONFLICT', '请先确认转写正文，再开始后续分析。');
      }
      const customBusinessRoles = Array.isArray(row.custom_business_roles)
        ? row.custom_business_roles
        : [];
      const created = await client.query(
        `INSERT INTO ${this.table('audio_post_analysis_jobs')}
           (tenant_id, audio_file_id, analysis_revision_id, transcript_confirmation_id,
            analysis_type, model, input_snapshot, status, progress,
            capability_binding_revision_id, staging_binding_revision_id)
         VALUES ($1, $2, $3, $4, $5, $6,
                 jsonb_build_object('customBusinessRoles', $7::jsonb), 'queued', 0, $8, $9)
         RETURNING id`,
        [
          this.tenantId,
          audioFileId,
          row.revision_id,
          row.confirmation_id,
          type,
          model,
          JSON.stringify(customBusinessRoles),
          capabilityBindingRevisionId,
          stagingBindingRevisionId,
        ],
      );
      const response = AudioPostAnalysisStartResponseSchema.parse({
        audioFileId,
        revisionId: row.revision_id,
        jobId: created.rows[0].id,
        type,
        status: 'queued',
      });
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new WorkspaceRepositoryError('CONFLICT', '该类型已有进行中的分析任务。');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** 单实例启动时重新排队进程中断的同类型任务。 */
  async resetInterrupted(type: AudioPostAnalysisType): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_post_analysis_jobs')}
       SET status = 'queued', progress = 0, error_code = NULL, error_message = NULL,
           error_retryable = NULL, completed_at = NULL
       WHERE tenant_id = $1 AND analysis_type = $2 AND status = 'running'`,
      [this.tenantId, type],
    );
  }

  /** 使用 SKIP LOCKED 领取指定类型最早的任务并加载其转写快照。 */
  async claim(type: AudioPostAnalysisType): Promise<ClaimedPostAnalysisJob | undefined> {
    const claimed = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM ${this.table('audio_post_analysis_jobs')}
         WHERE tenant_id = $1 AND analysis_type = $2 AND status = 'queued'
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE ${this.table('audio_post_analysis_jobs')} job
       SET status = 'running', progress = 1
       FROM candidate, ${this.table('audio_files')} af,
            ${this.table('transcript_confirmations')} tc,
            ${this.table('audio_analysis_revisions')} ar
       WHERE job.id = candidate.id AND af.tenant_id = job.tenant_id
         AND af.id = job.audio_file_id
         AND tc.tenant_id = job.tenant_id AND tc.id = job.transcript_confirmation_id
         AND ar.tenant_id = job.tenant_id AND ar.id = job.analysis_revision_id
       RETURNING job.id, job.analysis_type, job.model, job.audio_file_id,
                 job.analysis_revision_id, job.transcript_confirmation_id,
                 job.capability_binding_revision_id, job.staging_binding_revision_id,
                 tc.version_no AS confirmation_version, job.input_snapshot,
                 af.storage_key, af.duration_ms, af.deleted_at, af.source_state,
                 af.runtime_mode, af.storage_backend, af.storage_binding_revision_id,
                 (ar.bundled_emotion_job_id = job.id) AS bundled`,
      [this.tenantId, type],
    );
    const row = claimed.rows[0];
    if (!row) return undefined;
    const acousticSourceUnavailable =
      row.analysis_type === 'emotion' &&
      (row.source_state !== 'available' || !row.storage_key || row.duration_ms === null);
    if (row.deleted_at || acousticSourceUnavailable) {
      await this.fail(row.id, 'CONFLICT', '音频已归档或缺少可分析的音频文件，任务已停止。', false);
      return undefined;
    }
    const segments = await this.pool.query(
      `SELECT confirmed.confirmed_segment_id AS id, confirmed.speaker_key,
              confirmed.start_ms, confirmed.end_ms, confirmed.text
       FROM ${this.table('transcript_confirmation_segments')} confirmed
       WHERE confirmed.tenant_id = $1
         AND confirmed.transcript_confirmation_id = $2
       ORDER BY confirmed.start_ms, confirmed.end_ms, confirmed.part_index`,
      [this.tenantId, row.transcript_confirmation_id],
    );
    const snapshot =
      row.input_snapshot && typeof row.input_snapshot === 'object'
        ? (row.input_snapshot as Record<string, unknown>)
        : {};
    return {
      id: row.id,
      type: row.analysis_type,
      model: row.model,
      audioFileId: row.audio_file_id,
      revisionId: row.analysis_revision_id,
      // 角色识别只读 Transcript；源文件已清理时保留空定位键，不影响其执行。
      storageKey: row.storage_key ?? '',
      durationMs: Number(row.duration_ms ?? 0),
      confirmationId: row.transcript_confirmation_id,
      confirmationVersion: Number(row.confirmation_version),
      capabilityBindingRevisionId: row.capability_binding_revision_id ?? null,
      stagingBindingRevisionId: row.staging_binding_revision_id ?? null,
      runtimeMode: row.runtime_mode,
      storageBackend: row.storage_backend,
      storageBindingRevisionId: row.storage_binding_revision_id ?? null,
      bundled: Boolean(row.bundled),
      customBusinessRoles: Array.isArray(snapshot.customBusinessRoles)
        ? snapshot.customBusinessRoles.filter((value): value is string => typeof value === 'string')
        : [],
      segments: segments.rows.map((segment) => ({
        id: segment.id,
        speakerKey: String(segment.speaker_key),
        startMs: Number(segment.start_ms),
        endMs: Number(segment.end_ms),
        text: String(segment.text),
      })),
    };
  }

  /** 保存单调递增的任务进度。 */
  async updateProgress(jobId: string, progress: number): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_post_analysis_jobs')}
       SET progress = greatest(progress, $3)
       WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
      [this.tenantId, jobId, Math.max(1, Math.min(99, Math.round(progress)))],
    );
  }

  /** 原子发布全部逐段情绪，并切换修订的 active 情绪指针。 */
  async publishEmotion(job: ClaimedPostAnalysisJob, results: EmotionPublication[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const result of results) {
        await client.query(
          `INSERT INTO ${this.table('segment_emotion_results')}
             (tenant_id, job_id, analysis_revision_id, transcript_confirmation_id,
              confirmed_segment_id, emotion_label,
              confidence, attitude, arousal, pace, volume_trend, pitch_variation,
              pause_pattern, vocal_cues)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
          [
            this.tenantId,
            job.id,
            job.revisionId,
            job.confirmationId,
            result.segmentId,
            result.label,
            result.confidence,
            result.attitude,
            result.arousal,
            result.pace,
            result.volumeTrend,
            result.pitchVariation,
            result.pausePattern,
            JSON.stringify(result.vocalCues),
          ],
        );
      }
      await this.publishPointer(client, job, 'active_emotion_job_id');
      if (job.bundled) {
        await client.query(
          `UPDATE ${this.table('audio_analysis_revisions')}
           SET processing_checkpoint = 'acoustic_emotion_completed'
           WHERE tenant_id = $1 AND id = $2 AND bundled_emotion_job_id = $3`,
          [this.tenantId, job.revisionId, job.id],
        );
        await client.query(
          `UPDATE ${this.table('audio_files')}
           SET cleanup_status = 'pending', source_delete_after = now(), updated_at = now()
           WHERE tenant_id = $1 AND id = $2 AND runtime_mode = 'lightweight_local'
             AND source_state = 'available'`,
          [this.tenantId, job.audioFileId],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 原子发布全部说话人角色，并切换修订的 active 角色指针。 */
  async publishRoles(job: ClaimedPostAnalysisJob, results: RolePublication[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const result of results) {
        await client.query(
          `INSERT INTO ${this.table('speaker_role_results')}
             (tenant_id, job_id, analysis_revision_id, speaker_key, role_kind, role_label,
              confidence, evidence_segment_ids)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            this.tenantId,
            job.id,
            job.revisionId,
            result.speakerKey,
            result.kind,
            result.label,
            result.confidence,
            JSON.stringify(result.evidenceSegmentIds),
          ],
        );
      }
      await this.publishPointer(client, job, 'active_role_job_id');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async publishPointer(
    client: PoolClient,
    job: ClaimedPostAnalysisJob,
    column: 'active_emotion_job_id' | 'active_role_job_id',
  ): Promise<void> {
    const published = await client.query(
      `UPDATE ${this.table('audio_analysis_revisions')} ar
       SET ${column} = $3
       FROM ${this.table('audio_files')} af
       WHERE ar.tenant_id = $1 AND ar.id = $2 AND ar.status = 'ready'
         AND af.tenant_id = ar.tenant_id AND af.id = ar.audio_file_id
         AND af.deleted_at IS NULL
       RETURNING ar.id`,
      [this.tenantId, job.revisionId, job.id],
    );
    if (!published.rowCount) {
      throw new WorkspaceRepositoryError('CONFLICT', '音频已归档，分析结果未发布。');
    }
    await client.query(
      `UPDATE ${this.table('audio_post_analysis_jobs')}
       SET status = 'ready', progress = 100, completed_at = now(), published_at = now(),
           error_code = NULL, error_message = NULL, error_retryable = NULL
       WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
      [this.tenantId, job.id],
    );
  }

  /** 标记当前任务失败，既有 active 结果指针保持不变。 */
  async fail(jobId: string, code: string, message: string, retryable: boolean): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.table('audio_post_analysis_jobs')}
       SET status = CASE WHEN $5 AND retry_count < 2 THEN 'queued' ELSE 'failed' END,
           retry_count = retry_count + 1,
           progress = CASE WHEN $5 AND retry_count < 2 THEN 0 ELSE progress END,
           completed_at = CASE WHEN $5 AND retry_count < 2 THEN NULL ELSE now() END,
           error_code = $3, error_message = $4, error_retryable = $5
       WHERE tenant_id = $1 AND id = $2
       RETURNING status`,
      [this.tenantId, jobId, code, message.slice(0, 500), retryable],
    );
    if (!result.rows[0]) {
      throw new WorkspaceRepositoryError('CONFLICT', '后置分析任务状态已变化，无法记录失败。');
    }
    const finalFailure = result.rows[0]?.status === 'failed';
    if (!finalFailure) return false;
    await this.pool.query(
      `UPDATE ${this.table('audio_files')} af
       SET source_delete_after = now() + interval '24 hours', cleanup_status = 'pending',
           source_recovery_state = 'required', updated_at = now()
       FROM ${this.table('audio_post_analysis_jobs')} job,
            ${this.table('audio_analysis_revisions')} ar
       WHERE job.tenant_id = $1 AND job.id = $2
         AND ar.tenant_id = job.tenant_id AND ar.id = job.analysis_revision_id
         AND ar.bundled_emotion_job_id = job.id
         AND af.tenant_id = job.tenant_id AND af.id = job.audio_file_id
         AND af.runtime_mode = 'lightweight_local' AND af.source_state = 'available'`,
      [this.tenantId, jobId],
    );
    return true;
  }
}
