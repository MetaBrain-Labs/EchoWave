/**
 * 音频转写任务与修订发布仓储。
 *
 * 以 PostgreSQL 修订记录作为单实例 worker 的可恢复队列，并在一个事务中发布完整
 * 转写时间线；旧的 active revision 在新版本成功前保持不变。
 *
 * Responsibilities:
 * - 创建、领取和推进租户内音频转写任务。
 * - 原子写入场景与转写片段并切换 active 指针。
 * - 将失败限制在当前修订，避免破坏旧结果。
 *
 * Notes:
 * - 音频二进制仍由文件系统保存，本仓储只处理定位键和结构化结果。
 */
import path from 'node:path';

import {
  AUDIO_TRANSCRIPTION_DIRECT_FORMATS,
  AUDIO_TRANSCRIPTION_DIRECT_MAX_BYTES,
  AudioTranscriptionStartResponseSchema,
  type AudioTranscriptionPreprocessing,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import { WorkspaceRepositoryError } from './errors.ts';

/** worker 已领取的音频转写任务快照。 */
export type ClaimedAudioTranscription = {
  audioFileId: string;
  durationMs: number;
  mimeType: string;
  preprocessingMode: AudioTranscriptionPreprocessing;
  revisionId: string;
  revisionNo: number;
  sizeBytes: number;
  storageKey: string;
  title: string;
};

/** 通过模型校验、等待原子发布的单条转写片段。 */
export type TranscriptDraft = {
  businessRole: string;
  emotion: string;
  endMs: number;
  speakerKey: string;
  startMs: number;
  text: string;
};

/** 管理音频转写队列与发布事务的 PostgreSQL 仓储。 */
export class AudioAnalysisRepository {
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

  /** 为活动音频创建递增修订；部分唯一索引负责最终阻止并发重复任务。 */
  async queueTranscription(
    audioFileId: string,
    model: string,
    preprocessing: AudioTranscriptionPreprocessing,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const audio = await client.query(
        `SELECT id, storage_key, upload_status, duration_ms, size_bytes
         FROM ${this.table('audio_files')}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [this.tenantId, audioFileId],
      );
      const row = audio.rows[0];
      if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '音频不存在或已归档。');
      if (row.upload_status !== 'ready' || !row.storage_key || row.duration_ms === null) {
        throw new WorkspaceRepositoryError('CONFLICT', '音频尚未可靠保存，暂时不能转写。');
      }
      if (preprocessing === 'direct') {
        const format = path.extname(row.storage_key).slice(1).toLowerCase();
        const sizeBytes = Number(row.size_bytes);
        if (
          !AUDIO_TRANSCRIPTION_DIRECT_FORMATS.some((candidate) => candidate === format) ||
          !Number.isFinite(sizeBytes) ||
          sizeBytes > AUDIO_TRANSCRIPTION_DIRECT_MAX_BYTES
        ) {
          throw new WorkspaceRepositoryError(
            'DIRECT_AUDIO_REJECTED',
            '该音频无法直接发送，请启用 FFmpeg 预处理后重试。',
          );
        }
      }
      const revision = await client.query(
        `INSERT INTO ${this.table('audio_analysis_revisions')}
           (tenant_id, audio_file_id, revision_no, transcription_model, analysis_model,
            settings_snapshot, status, progress)
         SELECT $1, $2, coalesce(max(revision_no), 0) + 1, $3, $3,
                jsonb_build_object('speakerDiarization', true, 'businessRole', true,
                                   'emotionAnalysis', true, 'timestamps', 'milliseconds',
                                   'preprocessingMode', $4::text),
                'queued', 0
         FROM ${this.table('audio_analysis_revisions')}
         WHERE tenant_id = $1 AND audio_file_id = $2
         RETURNING id`,
        [this.tenantId, audioFileId, model, preprocessing],
      );
      const response = AudioTranscriptionStartResponseSchema.parse({
        audioFileId,
        revisionId: revision.rows[0].id,
        status: 'queued',
      });
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new WorkspaceRepositoryError('CONFLICT', '该音频已有进行中的转写任务。');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** 单实例启动时把进程中断留下的任务重新排队。 */
  async resetInterruptedTranscriptions(): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET status = 'queued', progress = 0
       WHERE tenant_id = $1 AND status IN ('transcribing', 'analyzing')`,
      [this.tenantId],
    );
  }

  /** 通过 `SKIP LOCKED` 领取最早的待转写修订。 */
  async claimTranscription(): Promise<ClaimedAudioTranscription | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM ${this.table('audio_analysis_revisions')}
         WHERE tenant_id = $1 AND status = 'queued'
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE ${this.table('audio_analysis_revisions')} ar
       SET status = 'transcribing', progress = 1
       FROM candidate, ${this.table('audio_files')} af
       WHERE ar.id = candidate.id AND af.tenant_id = ar.tenant_id
         AND af.id = ar.audio_file_id AND af.deleted_at IS NULL
       RETURNING ar.id AS revision_id, ar.revision_no, af.id AS audio_file_id,
                 af.title, af.storage_key, af.mime_type, af.duration_ms, af.size_bytes,
                 ar.settings_snapshot->>'preprocessingMode' AS preprocessing_mode`,
      [this.tenantId],
    );
    const row = result.rows[0];
    if (!row?.storage_key || row.duration_ms === null) return undefined;
    return {
      audioFileId: row.audio_file_id,
      durationMs: Number(row.duration_ms),
      mimeType: row.mime_type ?? 'application/octet-stream',
      preprocessingMode: row.preprocessing_mode === 'direct' ? 'direct' : 'ffmpeg',
      revisionId: row.revision_id,
      revisionNo: Number(row.revision_no),
      sizeBytes: Number(row.size_bytes),
      storageKey: row.storage_key,
      title: row.title,
    };
  }

  /** 更新当前修订对列表可见的粗粒度进度。 */
  async setProgress(job: ClaimedAudioTranscription, progress: number): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')} SET progress = $3
       WHERE tenant_id = $1 AND id = $2 AND status = 'transcribing'`,
      [this.tenantId, job.revisionId, Math.max(1, Math.min(99, Math.round(progress)))],
    );
  }

  /** 原子发布完整转写；音频若已归档则整个事务失败且不切换 active 指针。 */
  async publishTranscription(job: ClaimedAudioTranscription, segments: TranscriptDraft[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const scene = await client.query(
        `INSERT INTO ${this.table('analysis_scenes')}
           (tenant_id, analysis_revision_id, scene_index, title, start_ms)
         VALUES ($1, $2, 1, '完整录音', 0) RETURNING id`,
        [this.tenantId, job.revisionId],
      );
      const sceneId = scene.rows[0].id as string;
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]!;
        await client.query(
          `INSERT INTO ${this.table('transcript_segments')}
             (tenant_id, analysis_revision_id, scene_id, segment_index, speaker_key,
              speaker_label, business_role, emotion, start_ms, end_ms, text)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10)`,
          [
            this.tenantId,
            job.revisionId,
            sceneId,
            index + 1,
            segment.speakerKey,
            segment.businessRole,
            segment.emotion,
            segment.startMs,
            segment.endMs,
            segment.text,
          ],
        );
      }
      await client.query(
        `UPDATE ${this.table('audio_analysis_revisions')}
         SET status = 'ready', progress = 100, completed_at = now(), published_at = now(),
             error_stage = NULL, error_code = NULL, error_message = NULL, error_retryable = NULL
         WHERE tenant_id = $1 AND id = $2 AND status = 'transcribing'`,
        [this.tenantId, job.revisionId],
      );
      const published = await client.query(
        `UPDATE ${this.table('audio_files')}
         SET active_analysis_revision_id = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL RETURNING id`,
        [this.tenantId, job.audioFileId, job.revisionId],
      );
      if (!published.rowCount) {
        throw new WorkspaceRepositoryError('CONFLICT', '音频已归档，转写结果未发布。');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 将当前修订标记为转写失败，旧 active revision 保持不变。 */
  async failTranscription(
    job: ClaimedAudioTranscription,
    code: string,
    message: string,
    retryable: boolean,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET status = 'failed', completed_at = now(), error_stage = 'transcription',
           error_code = $3, error_message = $4, error_retryable = $5
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, job.revisionId, code, message, retryable],
    );
  }
}
