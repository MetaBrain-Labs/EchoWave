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
import {
  AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
  AudioTranscriptionModelSchema,
  AudioTranscriptionPreprocessingSchema,
  AudioTranscriptionSegmentationModeSchema,
  AudioTranscriptionStartResponseSchema,
  type AudioFailureDetails,
  type AudioTranscriptionPreprocessing,
  type AudioTranscriptionModel,
  type AudioTranscriptionProvider,
  type AudioTranscriptionResponseGranularity,
  type AudioTranscriptionSegmentationMode,
  type AudioTranscriptionSpeakerIdentityScope,
  type AudioTranscriptionStage,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import {
  VoiceActivityManifestSchema,
  type VoiceActivityManifest,
} from '../transcription/voiceActivity.ts';
import { WorkspaceRepositoryError } from './errors.ts';

/** worker 已领取的音频转写任务快照。 */
export type ClaimedAudioTranscription = {
  audioFileId: string;
  dataSource: {
    id: string;
    name: string;
    sourceType: string;
    location: string;
    connectionStatus: string;
  } | null;
  durationMs: number;
  ingestionRunId: string | null;
  mimeType: string;
  model: AudioTranscriptionModel;
  originalFilename: string | null;
  preprocessingManifest: VoiceActivityManifest | null;
  preprocessingMode: AudioTranscriptionPreprocessing;
  provider: AudioTranscriptionProvider;
  providerArtifactKey: string | null;
  providerSubmittedAt: Date | null;
  providerTaskId: string | null;
  revisionId: string;
  revisionNo: number;
  sizeBytes: number;
  segmentationMode: AudioTranscriptionSegmentationMode;
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

/** 原子发布时写回修订快照的实际 STT 能力。 */
export type TranscriptionPublicationMetadata = {
  diarizationObserved: boolean;
  diarizationRequested: boolean;
  language: 'zh';
  responseGranularity: AudioTranscriptionResponseGranularity;
  segmentationMode: AudioTranscriptionSegmentationMode;
  speakerIdentityScope: AudioTranscriptionSpeakerIdentityScope;
};

/** worker 写入列表投影的安全细粒度执行活动。 */
export type AudioTranscriptionActivityUpdate = {
  stage: AudioTranscriptionStage;
  progress: number;
  chunkIndex?: number;
  chunkCount?: number;
  chunkStartMs?: number;
  chunkEndMs?: number;
  networkAttempt?: number;
  structureAttempt?: number;
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
    model: AudioTranscriptionModel,
    preprocessing: AudioTranscriptionPreprocessing,
    segmentationMode: AudioTranscriptionSegmentationMode = 'speaker_turn',
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
      const capability = AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES.find(({ id }) => id === model);
      if (!capability) {
        throw new WorkspaceRepositoryError('CONFLICT', '所选转写模型已不再受支持。');
      }
      const revision = await client.query(
        `INSERT INTO ${this.table('audio_analysis_revisions')}
           (tenant_id, audio_file_id, revision_no, transcription_model, analysis_model,
            settings_snapshot, status, progress, processing_stage, processing_updated_at,
            transcription_provider)
         SELECT $1, $2, coalesce(max(revision_no), 0) + 1, $3, $3,
                jsonb_build_object('speakerDiarization', $5::boolean, 'businessRole', false,
                                   'emotionAnalysis', false, 'timestamps', $6::text,
                                   'preprocessingMode', $4::text, 'language', 'zh',
                                   'diarizationRequested', $5::boolean,
                                   'diarizationAvailability', $7::text,
                                   'segmentationMode', $8::text),
                'queued', 0, 'queued', now(), $9
         FROM ${this.table('audio_analysis_revisions')}
         WHERE tenant_id = $1 AND audio_file_id = $2
         RETURNING id`,
        [
          this.tenantId,
          audioFileId,
          model,
          preprocessing,
          capability.diarization,
          capability.timestampGranularity,
          capability.diarizationAvailability,
          segmentationMode,
          capability.provider,
        ],
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
       SET status = 'queued', progress = 0, processing_stage = 'queued',
           current_chunk = NULL, chunk_count = NULL, current_chunk_start_ms = NULL,
           current_chunk_end_ms = NULL, network_attempt = NULL, structure_attempt = NULL,
           processing_updated_at = now(), error_stage = NULL, error_code = NULL,
           error_message = NULL, error_retryable = NULL, error_details = NULL
       WHERE tenant_id = $1 AND transcription_provider = 'dashscope'
         AND status IN ('transcribing', 'analyzing')`,
      [this.tenantId],
    );
  }

  /** 通过 `SKIP LOCKED` 领取最早的待转写修订。 */
  async claimTranscription(): Promise<ClaimedAudioTranscription | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM ${this.table('audio_analysis_revisions')}
         WHERE tenant_id = $1 AND transcription_provider = 'dashscope' AND status = 'queued'
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE ${this.table('audio_analysis_revisions')} ar
       SET status = 'transcribing', progress = 1, processing_stage = 'preprocessing',
           current_chunk = NULL, chunk_count = NULL, current_chunk_start_ms = NULL,
           current_chunk_end_ms = NULL, network_attempt = NULL, structure_attempt = NULL,
           processing_updated_at = now()
       FROM candidate, ${this.table('audio_files')} af
       LEFT JOIN ${this.table('data_sources')} ds
         ON ds.tenant_id = af.tenant_id AND ds.id = af.data_source_id
       WHERE ar.id = candidate.id AND af.tenant_id = ar.tenant_id
         AND af.id = ar.audio_file_id AND af.deleted_at IS NULL
       RETURNING ar.id AS revision_id, ar.revision_no, af.id AS audio_file_id,
                 ar.transcription_model, af.title, af.original_filename, af.storage_key,
                 af.mime_type, af.duration_ms, af.size_bytes, af.ingestion_run_id,
                 ds.id AS data_source_id, ds.name AS data_source_name,
                 ds.source_type, ds.location AS data_source_location,
                 ds.connection_status AS data_source_connection_status,
                 ar.settings_snapshot->>'preprocessingMode' AS preprocessing_mode,
                 ar.settings_snapshot->'preprocessingManifest' AS preprocessing_manifest,
                 ar.settings_snapshot->>'segmentationMode' AS segmentation_mode,
                 ar.transcription_provider, ar.provider_task_id, ar.provider_artifact_key,
                 ar.provider_submitted_at`,
      [this.tenantId],
    );
    const row = result.rows[0];
    if (!row?.storage_key || row.duration_ms === null) return undefined;
    return {
      audioFileId: row.audio_file_id,
      dataSource: row.data_source_id
        ? {
            id: row.data_source_id,
            name: row.data_source_name,
            sourceType: row.source_type,
            location: row.data_source_location,
            connectionStatus: row.data_source_connection_status,
          }
        : null,
      durationMs: Number(row.duration_ms),
      ingestionRunId: row.ingestion_run_id ?? null,
      mimeType: row.mime_type ?? 'application/octet-stream',
      model: AudioTranscriptionModelSchema.parse(row.transcription_model),
      originalFilename: row.original_filename ?? null,
      preprocessingManifest:
        row.preprocessing_manifest == null
          ? null
          : VoiceActivityManifestSchema.parse(row.preprocessing_manifest),
      preprocessingMode: AudioTranscriptionPreprocessingSchema.parse(
        row.preprocessing_mode ?? 'whole_file',
      ),
      provider: 'dashscope',
      providerArtifactKey: row.provider_artifact_key ?? null,
      providerSubmittedAt: row.provider_submitted_at
        ? new Date(row.provider_submitted_at as string | Date)
        : null,
      providerTaskId: row.provider_task_id ?? null,
      revisionId: row.revision_id,
      revisionNo: Number(row.revision_no),
      sizeBytes: Number(row.size_bytes),
      segmentationMode: AudioTranscriptionSegmentationModeSchema.parse(
        row.segmentation_mode ?? 'speaker_turn',
      ),
      storageKey: row.storage_key,
      title: row.title,
    };
  }

  /** 保存临时 OSS 对象键，使重启后的 worker 能继续提交而不重复上传。 */
  async recordProviderArtifact(
    job: ClaimedAudioTranscription,
    objectKey: string,
    manifest: VoiceActivityManifest | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET provider_artifact_key = $3,
           settings_snapshot = CASE WHEN $4::jsonb IS NULL THEN settings_snapshot
             ELSE settings_snapshot || jsonb_build_object('preprocessingManifest', $4::jsonb) END
       WHERE tenant_id = $1 AND id = $2 AND status = 'transcribing'`,
      [this.tenantId, job.revisionId, objectKey, manifest ? JSON.stringify(manifest) : null],
    );
  }

  /** 原子保存供应商任务 ID 与提交时间，后续重启只恢复轮询。 */
  async recordProviderTask(
    job: ClaimedAudioTranscription,
    taskId: string,
    submittedAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET provider_task_id = $3, provider_submitted_at = $4
       WHERE tenant_id = $1 AND id = $2 AND status = 'transcribing'`,
      [this.tenantId, job.revisionId, taskId, submittedAt],
    );
  }

  /** 临时对象删除成功后清除对象定位信息，供应商任务 ID 保留用于审计。 */
  async clearProviderArtifact(job: ClaimedAudioTranscription): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET provider_artifact_key = NULL
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, job.revisionId],
    );
  }

  /** 原子更新当前修订对列表可见的阶段、Chunk 和单调进度。 */
  async updateActivity(
    job: ClaimedAudioTranscription,
    activity: AudioTranscriptionActivityUpdate,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET progress = greatest(progress, $3), processing_stage = $4,
           current_chunk = $5, chunk_count = $6, current_chunk_start_ms = $7,
           current_chunk_end_ms = $8, network_attempt = $9, structure_attempt = $10,
           processing_updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'transcribing'`,
      [
        this.tenantId,
        job.revisionId,
        Math.max(1, Math.min(99, Math.round(activity.progress))),
        activity.stage,
        activity.chunkIndex ?? null,
        activity.chunkCount ?? null,
        activity.chunkStartMs ?? null,
        activity.chunkEndMs ?? null,
        activity.networkAttempt ?? null,
        activity.structureAttempt ?? null,
      ],
    );
  }

  /** 原子发布完整转写；音频若已归档则整个事务失败且不切换 active 指针。 */
  async publishTranscription(
    job: ClaimedAudioTranscription,
    segments: TranscriptDraft[],
    metadata: TranscriptionPublicationMetadata,
  ) {
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
      for (const interval of job.preprocessingManifest?.skippedIntervals ?? []) {
        await client.query(
          `INSERT INTO ${this.table('analysis_invalid_segments')}
             (tenant_id, analysis_revision_id, start_ms, end_ms, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [this.tenantId, job.revisionId, interval.startMs, interval.endMs, interval.reason],
        );
      }
      await client.query(
        `UPDATE ${this.table('audio_analysis_revisions')}
         SET status = 'ready', progress = 100, completed_at = now(), published_at = now(),
             settings_snapshot = settings_snapshot ||
               jsonb_build_object('language', $3::text,
                                  'diarizationRequested', $4::boolean,
                                  'diarizationObserved', $5::boolean,
                                  'responseGranularity', $6::text,
                                  'segmentationMode', $7::text,
                                  'speakerIdentityScope', $8::text),
             error_stage = NULL, error_code = NULL, error_message = NULL,
             error_retryable = NULL, error_details = NULL, processing_stage = NULL,
             current_chunk = NULL, chunk_count = NULL, current_chunk_start_ms = NULL,
             current_chunk_end_ms = NULL, network_attempt = NULL, structure_attempt = NULL,
             processing_updated_at = NULL
         WHERE tenant_id = $1 AND id = $2 AND status = 'transcribing'`,
        [
          this.tenantId,
          job.revisionId,
          metadata.language,
          metadata.diarizationRequested,
          metadata.diarizationObserved,
          metadata.responseGranularity,
          metadata.segmentationMode,
          metadata.speakerIdentityScope,
        ],
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
    details: AudioFailureDetails | null = null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET status = 'failed', completed_at = now(), error_stage = 'transcription',
           error_code = $3, error_message = $4, error_retryable = $5,
           error_details = $6::jsonb, processing_stage = NULL, current_chunk = NULL,
           chunk_count = NULL, current_chunk_start_ms = NULL, current_chunk_end_ms = NULL,
           network_attempt = NULL, structure_attempt = NULL, processing_updated_at = NULL
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, job.revisionId, code, message, retryable, JSON.stringify(details)],
    );
  }
}
