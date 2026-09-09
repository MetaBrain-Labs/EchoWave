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
  AudioTranscriptionRunListResponseSchema,
  AudioTranscriptSelectionRequestSchema,
  SupportedLanguageSchema,
  type AudioFailureDetails,
  type AudioTranscriptionPreprocessing,
  type AudioTranscriptionModel,
  type AudioTranscriptionProvider,
  type AudioTranscriptionResponseGranularity,
  type AudioTranscriptionSegmentationMode,
  type AudioTranscriptionSpeakerIdentityScope,
  type AudioTranscriptionStage,
  type SupportedLanguage,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';
import { VoiceActivityManifestSchema, type VoiceActivityManifest } from './voiceActivity.ts';
import { WorkspaceRepositoryError } from '../../errors.ts';
import type { SpeakerReviewFindingDraft } from '../speaker-review/rules.ts';

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
  expectedSpeakerCount: number | null;
  ingestionRunId: string | null;
  mimeType: string;
  model: AudioTranscriptionModel;
  originalFilename: string | null;
  preprocessingManifest: VoiceActivityManifest | null;
  preprocessingMode: AudioTranscriptionPreprocessing;
  provider: AudioTranscriptionProvider;
  providerArtifactKey: string | null;
  providerLastPolledAt: Date | null;
  providerNextPollAt: Date | null;
  providerPollAttempt: number;
  providerSubmittedAt: Date | null;
  providerTaskId: string | null;
  providerTerminalErrorCode: string | null;
  providerTerminalErrorMessage: string | null;
  providerTerminalEventId: string | null;
  providerTerminalReceivedAt: Date | null;
  providerTerminalResultUrl: string | null;
  providerTerminalSource: 'polling' | 'eventbridge' | null;
  providerTerminalStatus: 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN' | null;
  revisionId: string;
  revisionNo: number;
  sizeBytes: number;
  segmentationMode: AudioTranscriptionSegmentationMode;
  storageKey: string;
  title: string;
  transcriptionBindingRevisionId: string | null;
  stagingBindingRevisionId: string | null;
  speakerReviewBindingRevisionId: string | null;
  speakerReviewModel: string | null;
  includeAcousticEmotion: boolean;
  language: SupportedLanguage;
  bundledEmotionBindingRevisionId: string | null;
  bundledEmotionModel: string | null;
  runtimeMode: 'hybrid' | 'object_storage' | 'lightweight_local';
  storageBackend: 'local_persistent' | 'local_ephemeral' | 'aliyun_oss';
  storageBindingRevisionId: string | null;
};

/** Polling 或 EventBridge 发现并允许写入 revision 的 DashScope 终态。 */
export type DashScopeProviderTerminal = {
  source: 'polling' | 'eventbridge';
  eventId: string | null;
  taskId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN';
  receivedAt: Date;
  resultUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

/** 终态发现报告所需的非敏感 revision 上下文。 */
export type RecordedProviderTerminal = {
  revisionId: string;
  durationMs: number;
  preprocessing: AudioTranscriptionPreprocessing;
};

/** 通过模型校验、等待原子发布的单条转写片段。 */
export type TranscriptDraft = {
  businessRole: string;
  emotion: string;
  endMs: number;
  speakerKey: string;
  startMs: number;
  text: string;
  words: TranscriptWordDraft[];
};

/** 供应商词级时间戳在发布前使用的规范结构。 */
export type TranscriptWordDraft = {
  startMs: number;
  endMs: number;
  text: string;
  punctuation: string;
};

/** 原子发布时写回修订快照的实际 STT 能力。 */
export type TranscriptionPublicationMetadata = {
  diarizationObserved: boolean;
  diarizationRequested: boolean;
  language: SupportedLanguage;
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

  /** 返回资产创建时固化的运行模式，供 ASR 启动解析存储与声学依赖。 */
  async getAssetRuntime(audioFileId: string) {
    const result = await this.pool.query(
      `SELECT runtime_mode, storage_backend, storage_binding_revision_id,
              source_state, source_recovery_state
       FROM ${this.table('audio_files')}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [this.tenantId, audioFileId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '音频不存在或已归档。');
    if (row.source_state !== 'available') {
      throw new WorkspaceRepositoryError('CONFLICT', '源音频不可用，需要重新选择原文件。');
    }
    if (row.source_recovery_state === 'required') {
      throw new WorkspaceRepositoryError(
        'CONFLICT',
        '上次任务已最终失败，请重新选择原文件后新建转写。',
      );
    }
    return {
      mode: row.runtime_mode as ClaimedAudioTranscription['runtimeMode'],
      storageBackend: row.storage_backend as ClaimedAudioTranscription['storageBackend'],
      storageBindingRevisionId: (row.storage_binding_revision_id as string | null) ?? null,
    };
  }

  /** 为活动音频创建递增修订；部分唯一索引负责最终阻止并发重复任务。 */
  async queueTranscription(
    audioFileId: string,
    model: AudioTranscriptionModel,
    preprocessing: AudioTranscriptionPreprocessing,
    segmentationMode: AudioTranscriptionSegmentationMode = 'speaker_turn',
    expectedSpeakerCount: number | null = null,
    transcriptionBindingRevisionId: string | null = null,
    stagingBindingRevisionId: string | null = null,
    speakerReviewBindingRevisionId: string | null = null,
    speakerReviewModel: string | null = null,
    notifyMode: 'polling' | 'eventbridge' = 'polling',
    includeAcousticEmotion = true,
    bundledEmotionBindingRevisionId: string | null = null,
    bundledEmotionModel: string | null = null,
    language: SupportedLanguage = 'zh-CN',
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
            transcription_provider, transcription_binding_revision_id,
             staging_binding_revision_id, speaker_review_binding_revision_id,
             include_acoustic_emotion, bundled_emotion_binding_revision_id,
             bundled_emotion_model)
         SELECT $1, $2, coalesce(max(revision_no), 0) + 1, $3, $3,
                jsonb_build_object('speakerDiarization', $5::boolean, 'businessRole', false,
                                   'emotionAnalysis', false, 'timestamps', $6::text,
                                   'preprocessingMode', $4::text, 'language', $19::text,
                                   'diarizationRequested', $5::boolean,
                                   'diarizationAvailability', $7::text,
                                   'segmentationMode', $8::text,
                                    'asyncNotifyMode', $12::text,
                                    'expectedSpeakerCount', $13::integer,
                                    'speakerReviewModel', $15::text),
                 'queued', 0, 'queued', now(), $9, $10, $11, $14, $16, $17, $18
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
          transcriptionBindingRevisionId,
          stagingBindingRevisionId,
          notifyMode,
          expectedSpeakerCount,
          speakerReviewBindingRevisionId,
          speakerReviewModel,
          includeAcousticEmotion,
          bundledEmotionBindingRevisionId,
          bundledEmotionModel,
          language,
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

  /** 启动时按当前通知模式恢复提交、终态发现和完成阶段。 */
  async resetInterruptedTranscriptions(_notifyMode: 'polling' | 'eventbridge'): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET status = 'queued', progress = 0, processing_stage = 'queued',
           current_chunk = NULL, chunk_count = NULL, current_chunk_start_ms = NULL,
           current_chunk_end_ms = NULL, network_attempt = NULL, structure_attempt = NULL,
           processing_updated_at = now(), error_stage = NULL, error_code = NULL,
           error_message = NULL, error_retryable = NULL, error_details = NULL
       WHERE tenant_id = $1 AND transcription_provider = 'dashscope'
         AND status IN ('transcribing', 'analyzing') AND provider_task_id IS NULL`,
      [this.tenantId],
    );
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET status = 'transcribing', progress = greatest(progress, 35),
           processing_stage = 'awaiting_result', current_chunk = NULL, chunk_count = NULL,
           current_chunk_start_ms = NULL, current_chunk_end_ms = NULL,
           network_attempt = NULL, structure_attempt = NULL, processing_updated_at = now(),
           error_stage = NULL, error_code = NULL, error_message = NULL,
           error_retryable = NULL, error_details = NULL,
           provider_next_poll_at = CASE
             WHEN coalesce(settings_snapshot->>'asyncNotifyMode', 'polling') = 'polling'
               AND provider_terminal_received_at IS NULL
               THEN coalesce(provider_next_poll_at, now())
             ELSE NULL
           END
       WHERE tenant_id = $1 AND transcription_provider = 'dashscope'
         AND status IN ('queued', 'transcribing', 'analyzing') AND provider_task_id IS NOT NULL`,
      [this.tenantId],
    );
  }

  /** 在供应商在途上限内通过 `SKIP LOCKED` 领取最早的待提交修订。 */
  async claimTranscription(maxInFlight: number): Promise<ClaimedAudioTranscription | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM ${this.table('audio_analysis_revisions')}
         WHERE tenant_id = $1 AND transcription_provider = 'dashscope' AND status = 'queued'
           AND (
             SELECT count(*) FROM ${this.table('audio_analysis_revisions')} active
             WHERE active.tenant_id = $1 AND active.transcription_provider = 'dashscope'
               AND active.status IN ('transcribing', 'analyzing')
               AND active.provider_task_id IS NOT NULL
           ) < $2
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
                 af.runtime_mode, af.storage_backend, af.storage_binding_revision_id,
                 ds.id AS data_source_id, ds.name AS data_source_name,
                 ds.source_type, ds.location AS data_source_location,
                 ds.connection_status AS data_source_connection_status,
                 ar.settings_snapshot->>'preprocessingMode' AS preprocessing_mode,
                 ar.settings_snapshot->'preprocessingManifest' AS preprocessing_manifest,
                 ar.settings_snapshot->>'segmentationMode' AS segmentation_mode,
                 coalesce(ar.settings_snapshot->>'language', 'zh-CN') AS language,
                 ar.transcription_provider, ar.provider_task_id, ar.provider_artifact_key,
                 ar.provider_submitted_at, ar.provider_terminal_source,
                 ar.provider_terminal_event_id, ar.provider_terminal_status,
                 ar.provider_terminal_received_at, ar.provider_terminal_result_url,
                 ar.provider_terminal_error_code, ar.provider_terminal_error_message,
                 ar.provider_poll_attempt, ar.provider_last_polled_at, ar.provider_next_poll_at,
                  ar.transcription_binding_revision_id, ar.staging_binding_revision_id,
                  ar.speaker_review_binding_revision_id,
                  ar.include_acoustic_emotion, ar.bundled_emotion_binding_revision_id,
                  ar.bundled_emotion_model,
                  ar.settings_snapshot->>'expectedSpeakerCount' AS expected_speaker_count,
                  ar.settings_snapshot->>'speakerReviewModel' AS speaker_review_model`,
      [this.tenantId, maxInFlight],
    );
    const row = result.rows[0];
    if (!row?.storage_key || row.duration_ms === null) return undefined;
    return this.mapClaimedTranscription(row);
  }

  /** 优先领取已发现供应商终态但尚未完成发布的 revision。 */
  async claimTerminalCompletion(): Promise<ClaimedAudioTranscription | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM ${this.table('audio_analysis_revisions')}
         WHERE tenant_id = $1 AND transcription_provider = 'dashscope'
           AND status = 'transcribing' AND provider_terminal_received_at IS NOT NULL
           AND processing_stage = 'awaiting_result'
         ORDER BY provider_terminal_received_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE ${this.table('audio_analysis_revisions')} ar
       SET progress = greatest(progress, 70), processing_stage = 'validating',
           processing_updated_at = now()
       FROM candidate, ${this.table('audio_files')} af
       LEFT JOIN ${this.table('data_sources')} ds
         ON ds.tenant_id = af.tenant_id AND ds.id = af.data_source_id
       WHERE ar.id = candidate.id AND af.tenant_id = ar.tenant_id
         AND af.id = ar.audio_file_id AND af.deleted_at IS NULL
       RETURNING ar.id AS revision_id, ar.revision_no, af.id AS audio_file_id,
                 ar.transcription_model, af.title, af.original_filename, af.storage_key,
                 af.mime_type, af.duration_ms, af.size_bytes, af.ingestion_run_id,
                 af.runtime_mode, af.storage_backend, af.storage_binding_revision_id,
                 ds.id AS data_source_id, ds.name AS data_source_name,
                 ds.source_type, ds.location AS data_source_location,
                 ds.connection_status AS data_source_connection_status,
                 ar.settings_snapshot->>'preprocessingMode' AS preprocessing_mode,
                 ar.settings_snapshot->'preprocessingManifest' AS preprocessing_manifest,
                 ar.settings_snapshot->>'segmentationMode' AS segmentation_mode,
                 coalesce(ar.settings_snapshot->>'language', 'zh-CN') AS language,
                 ar.transcription_provider, ar.provider_task_id, ar.provider_artifact_key,
                 ar.provider_submitted_at, ar.provider_terminal_source,
                 ar.provider_terminal_event_id, ar.provider_terminal_status,
                 ar.provider_terminal_received_at, ar.provider_terminal_result_url,
                 ar.provider_terminal_error_code, ar.provider_terminal_error_message,
                 ar.provider_poll_attempt, ar.provider_last_polled_at, ar.provider_next_poll_at,
                  ar.transcription_binding_revision_id, ar.staging_binding_revision_id,
                  ar.speaker_review_binding_revision_id,
                  ar.include_acoustic_emotion, ar.bundled_emotion_binding_revision_id,
                  ar.bundled_emotion_model,
                  ar.settings_snapshot->>'expectedSpeakerCount' AS expected_speaker_count,
                  ar.settings_snapshot->>'speakerReviewModel' AS speaker_review_model`,
      [this.tenantId],
    );
    const row = result.rows[0];
    if (!row?.storage_key || row.duration_ms === null) return undefined;
    return this.mapClaimedTranscription(row);
  }

  /** 领取一条已到查询时间的 Polling 任务；单次查询完成后必须显式安排下一次时间。 */
  async claimPollingDiscovery(): Promise<ClaimedAudioTranscription | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM ${this.table('audio_analysis_revisions')}
         WHERE tenant_id = $1 AND transcription_provider = 'dashscope'
           AND status = 'transcribing' AND provider_task_id IS NOT NULL
           AND provider_terminal_received_at IS NULL
           AND provider_next_poll_at IS NOT NULL AND provider_next_poll_at <= now()
           AND provider_submitted_at > now() - interval '6 hours'
           AND processing_stage = 'awaiting_result'
         ORDER BY provider_next_poll_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE ${this.table('audio_analysis_revisions')} ar
       SET provider_last_polled_at = now(), provider_next_poll_at = NULL,
           processing_updated_at = now()
       FROM candidate, ${this.table('audio_files')} af
       LEFT JOIN ${this.table('data_sources')} ds
         ON ds.tenant_id = af.tenant_id AND ds.id = af.data_source_id
       WHERE ar.id = candidate.id AND af.tenant_id = ar.tenant_id
         AND af.id = ar.audio_file_id AND af.deleted_at IS NULL
       RETURNING ar.id AS revision_id, ar.revision_no, af.id AS audio_file_id,
                 ar.transcription_model, af.title, af.original_filename, af.storage_key,
                 af.mime_type, af.duration_ms, af.size_bytes, af.ingestion_run_id,
                 af.runtime_mode, af.storage_backend, af.storage_binding_revision_id,
                 ds.id AS data_source_id, ds.name AS data_source_name,
                 ds.source_type, ds.location AS data_source_location,
                 ds.connection_status AS data_source_connection_status,
                 ar.settings_snapshot->>'preprocessingMode' AS preprocessing_mode,
                 ar.settings_snapshot->'preprocessingManifest' AS preprocessing_manifest,
                 ar.settings_snapshot->>'segmentationMode' AS segmentation_mode,
                 coalesce(ar.settings_snapshot->>'language', 'zh-CN') AS language,
                 ar.transcription_provider, ar.provider_task_id, ar.provider_artifact_key,
                 ar.provider_submitted_at, ar.provider_terminal_source,
                 ar.provider_terminal_event_id, ar.provider_terminal_status,
                 ar.provider_terminal_received_at, ar.provider_terminal_result_url,
                 ar.provider_terminal_error_code, ar.provider_terminal_error_message,
                 ar.provider_poll_attempt, ar.provider_last_polled_at, ar.provider_next_poll_at,
                  ar.transcription_binding_revision_id, ar.staging_binding_revision_id,
                  ar.speaker_review_binding_revision_id,
                  ar.include_acoustic_emotion, ar.bundled_emotion_binding_revision_id,
                  ar.bundled_emotion_model,
                  ar.settings_snapshot->>'expectedSpeakerCount' AS expected_speaker_count,
                  ar.settings_snapshot->>'speakerReviewModel' AS speaker_review_model`,
      [this.tenantId],
    );
    const row = result.rows[0];
    if (!row?.storage_key || row.duration_ms === null) return undefined;
    return this.mapClaimedTranscription(row);
  }

  /** 领取超过六小时仍未发现终态的任务，由 worker 统一失败并清理资源。 */
  async claimExpiredTranscription(): Promise<ClaimedAudioTranscription | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM ${this.table('audio_analysis_revisions')}
         WHERE tenant_id = $1 AND transcription_provider = 'dashscope'
           AND status = 'transcribing' AND provider_task_id IS NOT NULL
           AND provider_terminal_received_at IS NULL
           AND provider_submitted_at <= now() - interval '6 hours'
         ORDER BY provider_submitted_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE ${this.table('audio_analysis_revisions')} ar
       SET processing_stage = 'validating', processing_updated_at = now()
       FROM candidate, ${this.table('audio_files')} af
       LEFT JOIN ${this.table('data_sources')} ds
         ON ds.tenant_id = af.tenant_id AND ds.id = af.data_source_id
       WHERE ar.id = candidate.id AND af.tenant_id = ar.tenant_id
         AND af.id = ar.audio_file_id AND af.deleted_at IS NULL
       RETURNING ar.id AS revision_id, ar.revision_no, af.id AS audio_file_id,
                 ar.transcription_model, af.title, af.original_filename, af.storage_key,
                 af.mime_type, af.duration_ms, af.size_bytes, af.ingestion_run_id,
                 af.runtime_mode, af.storage_backend, af.storage_binding_revision_id,
                 ds.id AS data_source_id, ds.name AS data_source_name,
                 ds.source_type, ds.location AS data_source_location,
                 ds.connection_status AS data_source_connection_status,
                 ar.settings_snapshot->>'preprocessingMode' AS preprocessing_mode,
                 ar.settings_snapshot->'preprocessingManifest' AS preprocessing_manifest,
                 ar.settings_snapshot->>'segmentationMode' AS segmentation_mode,
                 coalesce(ar.settings_snapshot->>'language', 'zh-CN') AS language,
                 ar.transcription_provider, ar.provider_task_id, ar.provider_artifact_key,
                 ar.provider_submitted_at, ar.provider_terminal_source,
                 ar.provider_terminal_event_id, ar.provider_terminal_status,
                 ar.provider_terminal_received_at, ar.provider_terminal_result_url,
                 ar.provider_terminal_error_code, ar.provider_terminal_error_message,
                 ar.provider_poll_attempt, ar.provider_last_polled_at, ar.provider_next_poll_at,
                  ar.transcription_binding_revision_id, ar.staging_binding_revision_id,
                  ar.speaker_review_binding_revision_id,
                  ar.include_acoustic_emotion, ar.bundled_emotion_binding_revision_id,
                  ar.bundled_emotion_model,
                  ar.settings_snapshot->>'expectedSpeakerCount' AS expected_speaker_count,
                  ar.settings_snapshot->>'speakerReviewModel' AS speaker_review_model`,
      [this.tenantId],
    );
    const row = result.rows[0];
    if (!row?.storage_key || row.duration_ms === null) return undefined;
    return this.mapClaimedTranscription(row);
  }

  /** 返回最近的供应商查询或六小时超时截止点，避免固定高频扫描时间驱动任务。 */
  async nextWorkerWakeAt(_notifyMode: 'polling' | 'eventbridge'): Promise<Date | undefined> {
    const result = await this.pool.query(
      `SELECT min(wake_at) AS wake_at
       FROM (
         SELECT provider_submitted_at + interval '6 hours' AS wake_at
         FROM ${this.table('audio_analysis_revisions')}
         WHERE tenant_id = $1 AND transcription_provider = 'dashscope'
           AND status = 'transcribing' AND provider_task_id IS NOT NULL
           AND provider_terminal_received_at IS NULL AND provider_submitted_at IS NOT NULL
         UNION ALL
         SELECT provider_next_poll_at AS wake_at
         FROM ${this.table('audio_analysis_revisions')}
         WHERE tenant_id = $1 AND transcription_provider = 'dashscope'
           AND coalesce(settings_snapshot->>'asyncNotifyMode', 'polling') = 'polling'
           AND status = 'transcribing' AND provider_task_id IS NOT NULL
           AND provider_terminal_received_at IS NULL AND provider_next_poll_at IS NOT NULL
           AND processing_stage = 'awaiting_result'
       ) deadlines`,
      [this.tenantId],
    );
    const wakeAt = result.rows[0]?.wake_at;
    return wakeAt ? new Date(wakeAt as string | Date) : undefined;
  }

  private mapClaimedTranscription(row: Record<string, any>): ClaimedAudioTranscription {
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
      expectedSpeakerCount:
        row.expected_speaker_count == null ? null : Number(row.expected_speaker_count),
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
      providerLastPolledAt: row.provider_last_polled_at
        ? new Date(row.provider_last_polled_at as string | Date)
        : null,
      providerNextPollAt: row.provider_next_poll_at
        ? new Date(row.provider_next_poll_at as string | Date)
        : null,
      providerPollAttempt: Number(row.provider_poll_attempt ?? 0),
      providerSubmittedAt: row.provider_submitted_at
        ? new Date(row.provider_submitted_at as string | Date)
        : null,
      providerTaskId: row.provider_task_id ?? null,
      providerTerminalErrorCode: (row.provider_terminal_error_code as string | null) ?? null,
      providerTerminalErrorMessage: (row.provider_terminal_error_message as string | null) ?? null,
      providerTerminalEventId: (row.provider_terminal_event_id as string | null) ?? null,
      providerTerminalReceivedAt: row.provider_terminal_received_at
        ? new Date(row.provider_terminal_received_at as string | Date)
        : null,
      providerTerminalResultUrl: (row.provider_terminal_result_url as string | null) ?? null,
      providerTerminalSource:
        (row.provider_terminal_source as ClaimedAudioTranscription['providerTerminalSource']) ??
        null,
      providerTerminalStatus:
        (row.provider_terminal_status as ClaimedAudioTranscription['providerTerminalStatus']) ??
        null,
      revisionId: row.revision_id,
      revisionNo: Number(row.revision_no),
      sizeBytes: Number(row.size_bytes),
      segmentationMode: AudioTranscriptionSegmentationModeSchema.parse(
        row.segmentation_mode ?? 'speaker_turn',
      ),
      storageKey: row.storage_key,
      title: row.title,
      transcriptionBindingRevisionId: row.transcription_binding_revision_id ?? null,
      stagingBindingRevisionId: row.staging_binding_revision_id ?? null,
      speakerReviewBindingRevisionId: row.speaker_review_binding_revision_id ?? null,
      speakerReviewModel: row.speaker_review_model ?? null,
      includeAcousticEmotion: Boolean(row.include_acoustic_emotion),
      language: SupportedLanguageSchema.parse(row.language === 'en' ? 'en' : 'zh-CN'),
      bundledEmotionBindingRevisionId: row.bundled_emotion_binding_revision_id ?? null,
      bundledEmotionModel: row.bundled_emotion_model ?? null,
      runtimeMode: row.runtime_mode,
      storageBackend: row.storage_backend,
      storageBindingRevisionId: row.storage_binding_revision_id ?? null,
    };
  }

  /** 仅为 EventBridge 验签解析任务创建时冻结的能力 revision。 */
  async findTranscriptionBindingByTaskId(taskId: string): Promise<string | null | undefined> {
    const result = await this.pool.query(
      `SELECT transcription_binding_revision_id
       FROM ${this.table('audio_analysis_revisions')}
       WHERE tenant_id = $1 AND transcription_provider = 'dashscope' AND provider_task_id = $2
       LIMIT 1`,
      [this.tenantId, taskId],
    );
    if (!result.rows[0]) return undefined;
    return result.rows[0].transcription_binding_revision_id ?? null;
  }

  /** 保存临时 OSS 对象键，使重启后的 worker 能继续提交而不重复上传。 */
  async recordPreprocessing(
    job: ClaimedAudioTranscription,
    manifest: VoiceActivityManifest | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET processing_checkpoint = 'preprocessing_ready',
           settings_snapshot = CASE WHEN $3::jsonb IS NULL THEN settings_snapshot
             ELSE settings_snapshot || jsonb_build_object('preprocessingManifest', $3::jsonb) END
       WHERE tenant_id = $1 AND id = $2 AND status = 'transcribing'`,
      [this.tenantId, job.revisionId, manifest ? JSON.stringify(manifest) : null],
    );
  }

  /** 保存供应商暂存对象键，使重启后的 worker 不重复上传。 */
  async recordProviderArtifact(
    job: ClaimedAudioTranscription,
    objectKey: string,
    manifest: VoiceActivityManifest | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET provider_artifact_key = $3,
           processing_checkpoint = 'provider_staged',
           settings_snapshot = CASE WHEN $4::jsonb IS NULL THEN settings_snapshot
             ELSE settings_snapshot || jsonb_build_object('preprocessingManifest', $4::jsonb) END
       WHERE tenant_id = $1 AND id = $2 AND status = 'transcribing'`,
      [this.tenantId, job.revisionId, objectKey, manifest ? JSON.stringify(manifest) : null],
    );
  }

  /** 原子保存供应商任务与发现模式的初始调度状态。 */
  async recordProviderTask(
    job: ClaimedAudioTranscription,
    taskId: string,
    submittedAt: Date,
    notifyMode: 'polling' | 'eventbridge',
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET provider_task_id = $3, provider_submitted_at = $4,
           processing_checkpoint = 'provider_submitted',
           provider_poll_attempt = 0, provider_last_polled_at = NULL,
           provider_next_poll_at = CASE WHEN $5 = 'polling' THEN now() ELSE NULL END
       WHERE tenant_id = $1 AND id = $2 AND status = 'transcribing'`,
      [this.tenantId, job.revisionId, taskId, submittedAt, notifyMode],
    );
  }

  /** 为未完成的 Polling 任务持久化下一次查询时间。 */
  async scheduleNextPoll(
    job: ClaimedAudioTranscription,
    attempt: number,
    delayMs: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET provider_poll_attempt = $3,
           provider_next_poll_at = now() + ($4 * interval '1 millisecond'),
           processing_stage = 'awaiting_result', processing_updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'transcribing'
         AND provider_terminal_received_at IS NULL`,
      [this.tenantId, job.revisionId, attempt, delayMs],
    );
  }

  /** 幂等保存首个合法终态；重复、冲突或未知任务不会覆盖已接受事实。 */
  async recordProviderTerminal(
    terminal: DashScopeProviderTerminal,
  ): Promise<RecordedProviderTerminal | undefined> {
    const result = await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')} ar
       SET provider_terminal_source = $3, provider_terminal_event_id = $4,
           provider_terminal_status = $5, provider_terminal_received_at = $6,
           provider_terminal_result_url = $7, provider_terminal_error_code = $8,
           provider_terminal_error_message = $9, provider_next_poll_at = NULL,
           processing_checkpoint = 'provider_terminal',
           progress = greatest(progress, 60), processing_stage = 'awaiting_result',
           processing_updated_at = now()
       FROM ${this.table('audio_files')} af
       WHERE ar.tenant_id = $1 AND ar.provider_task_id = $2
         AND ar.transcription_provider = 'dashscope'
         AND ar.status IN ('queued', 'transcribing', 'analyzing')
         AND ar.provider_terminal_source IS NULL
         AND af.tenant_id = ar.tenant_id AND af.id = ar.audio_file_id
       RETURNING ar.id AS revision_id, af.duration_ms,
                 ar.settings_snapshot->>'preprocessingMode' AS preprocessing_mode`,
      [
        this.tenantId,
        terminal.taskId,
        terminal.source,
        terminal.eventId,
        terminal.status,
        terminal.receivedAt,
        terminal.resultUrl,
        terminal.errorCode,
        terminal.errorMessage,
      ],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      revisionId: row.revision_id,
      durationMs: Number(row.duration_ms),
      preprocessing: AudioTranscriptionPreprocessingSchema.parse(
        row.preprocessing_mode ?? 'whole_file',
      ),
    };
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
    speakerReviewFindings: SpeakerReviewFindingDraft[] = [],
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
      const segmentIds: string[] = [];
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]!;
        const inserted = await client.query(
          `INSERT INTO ${this.table('transcript_segments')}
             (tenant_id, analysis_revision_id, scene_id, segment_index, speaker_key,
               speaker_label, business_role, emotion, start_ms, end_ms, text, words)
            VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11::jsonb)
            RETURNING id`,
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
            JSON.stringify(
              (segment.words ?? []).map((word, wordIndex) => ({
                index: wordIndex,
                startMs: word.startMs,
                endMs: word.endMs,
                text: word.text,
                punctuation: word.punctuation,
              })),
            ),
          ],
        );
        segmentIds.push(String(inserted.rows[0].id));
      }
      for (const finding of speakerReviewFindings) {
        const sourceSegmentId =
          finding.sourceSegmentIndex === null ? null : segmentIds[finding.sourceSegmentIndex];
        if (finding.sourceSegmentIndex !== null && !sourceSegmentId) continue;
        await client.query(
          `INSERT INTO ${this.table('speaker_review_findings')}
             (tenant_id, analysis_revision_id, source_transcript_segment_id,
              split_after_word_index, kind, severity, reason_code, explanation, finding_source)
           VALUES ($1, $2, $3, $4, 'speaker_turn_suspected', $5, $6, $7, $8)`,
          [
            this.tenantId,
            job.revisionId,
            sourceSegmentId,
            finding.splitAfterWordIndex,
            finding.severity,
            finding.reasonCode,
            finding.explanation,
            finding.source,
          ],
        );
      }
      if (job.speakerReviewModel) {
        await client.query(
          `INSERT INTO ${this.table('audio_speaker_review_jobs')}
             (tenant_id, audio_file_id, analysis_revision_id,
              capability_binding_revision_id, model, settings_snapshot, status)
           VALUES ($1, $2, $3, $4, $5, jsonb_build_object('language', $6::text), 'queued')`,
          [
            this.tenantId,
            job.audioFileId,
            job.revisionId,
            job.speakerReviewBindingRevisionId,
            job.speakerReviewModel,
            job.language,
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
             processing_updated_at = NULL, provider_terminal_result_url = NULL
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
      let lightweightConfirmationId: string | undefined;
      if (job.runtimeMode === 'lightweight_local') {
        if (
          job.includeAcousticEmotion &&
          (!job.bundledEmotionBindingRevisionId || !job.bundledEmotionModel)
        ) {
          throw new WorkspaceRepositoryError(
            'CONFLICT',
            '轻量模式声学情绪能力未被固定到 ASR Run。',
          );
        }
        const snapshot = await client.query(
          `INSERT INTO ${this.table('transcript_confirmations')}
             (tenant_id, analysis_revision_id, version_no, origin)
           VALUES ($1, $2, 1, 'system_raw_snapshot') RETURNING id`,
          [this.tenantId, job.revisionId],
        );
        lightweightConfirmationId = String(snapshot.rows[0].id);
        await client.query(
          `INSERT INTO ${this.table('transcript_confirmation_segments')}
             (tenant_id, transcript_confirmation_id, analysis_revision_id,
              source_transcript_segment_id, confirmed_segment_id, part_index,
              speaker_key, start_word_index, end_word_index, start_ms, end_ms, text)
           SELECT segment.tenant_id, $3, segment.analysis_revision_id,
                  segment.id, segment.id, segment.segment_index, segment.speaker_key, 0,
                  greatest(jsonb_array_length(segment.words), 1),
                  segment.start_ms, segment.end_ms, segment.text
           FROM ${this.table('transcript_segments')} segment
           WHERE segment.tenant_id = $1 AND segment.analysis_revision_id = $2`,
          [this.tenantId, job.revisionId, lightweightConfirmationId],
        );
        await client.query(
          `UPDATE ${this.table('audio_analysis_revisions')}
           SET active_transcript_confirmation_id = $3,
               processing_checkpoint = 'transcript_published'
           WHERE tenant_id = $1 AND id = $2`,
          [this.tenantId, job.revisionId, lightweightConfirmationId],
        );
        if (job.includeAcousticEmotion) {
          const emotion = await client.query(
            `INSERT INTO ${this.table('audio_post_analysis_jobs')}
               (tenant_id, audio_file_id, analysis_revision_id, transcript_confirmation_id,
                analysis_type, model, input_snapshot, status, progress,
                capability_binding_revision_id, staging_binding_revision_id)
             VALUES ($1, $2, $3, $4, 'emotion', $5,
                     jsonb_build_object('language', $7::text), 'queued', 0, $6, NULL)
             RETURNING id`,
            [
              this.tenantId,
              job.audioFileId,
              job.revisionId,
              lightweightConfirmationId,
              job.bundledEmotionModel,
              job.bundledEmotionBindingRevisionId,
              job.language,
            ],
          );
          await client.query(
            `UPDATE ${this.table('audio_analysis_revisions')}
             SET bundled_emotion_job_id = $3
             WHERE tenant_id = $1 AND id = $2`,
            [this.tenantId, job.revisionId, emotion.rows[0].id],
          );
        } else {
          await client.query(
            `UPDATE ${this.table('audio_analysis_revisions')}
             SET processing_checkpoint = 'transcript_published'
             WHERE tenant_id = $1 AND id = $2`,
            [this.tenantId, job.revisionId],
          );
          await client.query(
            `UPDATE ${this.table('audio_files')}
             SET cleanup_status = 'pending', source_delete_after = now(), updated_at = now()
             WHERE tenant_id = $1 AND id = $2 AND source_state = 'available'`,
            [this.tenantId, job.audioFileId],
          );
        }
      } else {
        await client.query(
          `UPDATE ${this.table('audio_analysis_revisions')}
           SET processing_checkpoint = 'transcript_published'
           WHERE tenant_id = $1 AND id = $2`,
          [this.tenantId, job.revisionId],
        );
      }
      const published = await client.query(
        `UPDATE ${this.table('audio_files')}
         SET active_analysis_revision_id = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
           AND (transcript_selection_mode = 'auto' OR active_analysis_revision_id IS NULL)
         RETURNING id`,
        [this.tenantId, job.audioFileId, job.revisionId],
      );
      if (!published.rowCount) {
        const active = await client.query(
          `SELECT id FROM ${this.table('audio_files')}
           WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [this.tenantId, job.audioFileId],
        );
        if (!active.rowCount) {
          throw new WorkspaceRepositoryError('CONFLICT', '音频已归档，转写结果未发布。');
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 列出一个音频的全部 ASR Run 以及当前选择策略。 */
  async listTranscriptions(audioFileId: string) {
    const audio = await this.pool.query<{
      active_analysis_revision_id: string | null;
      transcript_selection_mode: 'auto' | 'manual';
    }>(
      `SELECT active_analysis_revision_id, transcript_selection_mode
       FROM ${this.table('audio_files')}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [this.tenantId, audioFileId],
    );
    const source = audio.rows[0];
    if (!source) throw new WorkspaceRepositoryError('NOT_FOUND', '音频不存在或已归档。');
    const runs = await this.pool.query<{
      id: string;
      revision_no: number;
      status: 'queued' | 'transcribing' | 'analyzing' | 'ready' | 'failed';
      transcription_model: string;
      include_acoustic_emotion: boolean;
      settings_snapshot: Record<string, unknown>;
      created_at: Date;
      completed_at: Date | null;
    }>(
      `SELECT id, revision_no, status, transcription_model, include_acoustic_emotion,
              settings_snapshot, created_at, completed_at
       FROM ${this.table('audio_analysis_revisions')}
       WHERE tenant_id = $1 AND audio_file_id = $2
       ORDER BY revision_no DESC`,
      [this.tenantId, audioFileId],
    );
    return AudioTranscriptionRunListResponseSchema.parse({
      selectionMode: source.transcript_selection_mode,
      activeRevisionId: source.active_analysis_revision_id,
      items: runs.rows.map((row) => ({
        id: row.id,
        revision: Number(row.revision_no),
        status: row.status,
        model: row.transcription_model,
        preprocessing:
          row.settings_snapshot.preprocessingMode === 'silero_vad' ? 'silero_vad' : 'whole_file',
        includeAcousticEmotion: row.include_acoustic_emotion,
        language: row.settings_snapshot.language ?? 'zh-CN',
        active: row.id === source.active_analysis_revision_id,
        createdAt: row.created_at.toISOString(),
        completedAt: row.completed_at?.toISOString() ?? null,
      })),
    });
  }

  /** 固定一个成功 ASR Run，或恢复自动跟随最新成功结果。 */
  async selectTranscription(audioFileId: string, input: unknown) {
    const request = AudioTranscriptSelectionRequestSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const audio = await client.query(
        `SELECT id FROM ${this.table('audio_files')}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [this.tenantId, audioFileId],
      );
      if (!audio.rowCount) throw new WorkspaceRepositoryError('NOT_FOUND', '音频不存在或已归档。');
      let revisionId: string | null;
      if (request.mode === 'manual') {
        const revision = await client.query<{ id: string }>(
          `SELECT id FROM ${this.table('audio_analysis_revisions')}
           WHERE tenant_id = $1 AND audio_file_id = $2 AND id = $3 AND status = 'ready'`,
          [this.tenantId, audioFileId, request.revisionId],
        );
        if (!revision.rowCount) {
          throw new WorkspaceRepositoryError('CONFLICT', '只能选择已经成功发布的 ASR 结果。');
        }
        revisionId = request.revisionId;
      } else {
        const latest = await client.query<{ id: string }>(
          `SELECT id FROM ${this.table('audio_analysis_revisions')}
           WHERE tenant_id = $1 AND audio_file_id = $2 AND status = 'ready'
           ORDER BY revision_no DESC LIMIT 1`,
          [this.tenantId, audioFileId],
        );
        revisionId = latest.rows[0]?.id ?? null;
      }
      await client.query(
        `UPDATE ${this.table('audio_files')}
         SET transcript_selection_mode = $3, active_analysis_revision_id = $4, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, audioFileId, request.mode, revisionId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.listTranscriptions(audioFileId);
  }

  /** 将当前修订标记为转写失败，旧 active revision 保持不变。 */
  async failTranscription(
    job: ClaimedAudioTranscription,
    code: string,
    message: string,
    retryable: boolean,
    details: AudioFailureDetails | null = null,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET status = CASE
             WHEN $5 AND retry_count < 2 AND provider_task_id IS NULL THEN 'queued'
             WHEN $5 AND retry_count < 2 THEN 'transcribing'
             ELSE 'failed'
           END,
           retry_count = retry_count + 1,
           completed_at = CASE WHEN $5 AND retry_count < 2 THEN NULL ELSE now() END,
           error_stage = 'transcription',
           error_code = $3, error_message = $4, error_retryable = $5,
           error_details = $6::jsonb,
           processing_stage = CASE
             WHEN $5 AND retry_count < 2 AND provider_task_id IS NULL THEN 'queued'
             WHEN $5 AND retry_count < 2 THEN 'awaiting_result'
             ELSE NULL
           END,
           progress = CASE
             WHEN $5 AND retry_count < 2 AND provider_task_id IS NULL THEN 0
             WHEN $5 AND retry_count < 2 THEN greatest(progress, 35)
             ELSE progress
           END,
           current_chunk = NULL,
           chunk_count = NULL, current_chunk_start_ms = NULL, current_chunk_end_ms = NULL,
           network_attempt = NULL, structure_attempt = NULL, processing_updated_at = NULL,
           provider_next_poll_at = CASE
             WHEN $5 AND retry_count < 2 AND provider_task_id IS NOT NULL
              AND provider_terminal_received_at IS NULL THEN now()
             ELSE provider_next_poll_at
           END,
           provider_terminal_result_url = CASE
             WHEN $5 AND retry_count < 2 THEN provider_terminal_result_url ELSE NULL END
       WHERE tenant_id = $1 AND id = $2
       RETURNING status`,
      [this.tenantId, job.revisionId, code, message, retryable, JSON.stringify(details)],
    );
    if (!result.rows[0]) {
      throw new WorkspaceRepositoryError('CONFLICT', '转写任务状态已变化，无法记录失败。');
    }
    const finalFailure = result.rows[0]?.status === 'failed';
    if (finalFailure && job.runtimeMode === 'lightweight_local') {
      await this.pool.query(
        `UPDATE ${this.table('audio_files')}
         SET source_delete_after = now() + interval '24 hours', cleanup_status = 'pending',
             source_recovery_state = 'required', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND source_state = 'available'`,
        [this.tenantId, job.audioFileId],
      );
    }
    return finalFailure;
  }
}
