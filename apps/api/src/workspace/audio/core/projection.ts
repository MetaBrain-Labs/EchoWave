/**
 * 工作区音频投影。
 *
 * 集中维护跨分组和数据源读取共用的音频状态恢复，以及分组可见音频 CTE；
 * 不承载 CRUD、连接生命周期或领域事务。
 *
 * Responsibilities:
 * - 将持久化状态映射为稳定的音频处理状态。
 * - 构造租户内分组可见音频的 SQL CTE。
 *
 * Notes:
 * - 表名仍由具体 Repository 提供并完成 schema 限定。
 */
import {
  AudioFailureDetailsSchema,
  AudioTranscriptionActivitySchema,
  type AudioProcessingStatus,
} from '@echowave/contracts';

export function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export function integer(value: unknown): number {
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
      details: null,
    };
  }
  switch (row.analysis_status) {
    case 'queued':
    case 'transcribing': {
      const activity = AudioTranscriptionActivitySchema.safeParse({
        stage: row.analysis_processing_stage,
        chunkIndex:
          row.analysis_current_chunk === null || row.analysis_current_chunk === undefined
            ? null
            : integer(row.analysis_current_chunk),
        chunkCount:
          row.analysis_chunk_count === null || row.analysis_chunk_count === undefined
            ? null
            : integer(row.analysis_chunk_count),
        chunkStartMs:
          row.analysis_current_chunk_start_ms === null ||
          row.analysis_current_chunk_start_ms === undefined
            ? null
            : integer(row.analysis_current_chunk_start_ms),
        chunkEndMs:
          row.analysis_current_chunk_end_ms === null ||
          row.analysis_current_chunk_end_ms === undefined
            ? null
            : integer(row.analysis_current_chunk_end_ms),
        networkAttempt:
          row.analysis_network_attempt === null || row.analysis_network_attempt === undefined
            ? null
            : integer(row.analysis_network_attempt),
        structureAttempt:
          row.analysis_structure_attempt === null || row.analysis_structure_attempt === undefined
            ? null
            : integer(row.analysis_structure_attempt),
        updatedAt: row.analysis_processing_updated_at
          ? iso(row.analysis_processing_updated_at as Date | string)
          : undefined,
      });
      return {
        kind: 'transcribing',
        progress: row.analysis_status === 'queued' ? 0 : integer(row.analysis_progress),
        activity: activity.success ? activity.data : null,
      };
    }
    case 'analyzing':
      return { kind: 'analyzing', progress: integer(row.analysis_progress) };
    case 'ready':
      return { kind: 'ready' };
    case 'failed': {
      const stage = row.analysis_error_stage === 'transcription' ? 'transcription' : 'analysis';
      const details = AudioFailureDetailsSchema.safeParse(row.analysis_error_details);
      return {
        kind: 'failed',
        stage,
        code: String(row.analysis_error_code ?? 'ANALYSIS_FAILED'),
        message: String(row.analysis_error_message ?? '音频分析失败。'),
        retryable: Boolean(row.analysis_error_retryable),
        details: details.success ? details.data : null,
      };
    }
    default:
      return { kind: 'waiting' };
  }
}

export function audioItem(row: Record<string, any>) {
  return {
    id: row.id,
    sourceId: row.data_source_id ?? null,
    title: row.title,
    durationMs: row.duration_ms === null ? null : integer(row.duration_ms),
    createdAt: iso(row.created_at),
    sharedFrom: row.shared_from ?? null,
    hasTranscript: Boolean(row.active_analysis_revision_id),
    status: audioStatus(row),
    runtimeMode: row.runtime_mode,
    sourceState: row.source_state,
    sourceRecoveryState: row.source_recovery_state,
    sourceDeleteAfter: row.source_delete_after ? iso(row.source_delete_after) : null,
    acousticEmotionReady: Boolean(row.acoustic_emotion_ready),
  };
}

const visibleAudioCte = `
  visible_audio AS (
    SELECT gal.tenant_id, gal.group_id, gal.audio_file_id
    FROM group_audio_links gal
    UNION
    SELECT gds.tenant_id, gds.group_id, af.id
    FROM group_data_sources gds
    JOIN __active_data_sources__ ds
      ON ds.tenant_id = gds.tenant_id
     AND ds.id = gds.data_source_id
     AND ds.deleted_at IS NULL
    JOIN audio_files af
      ON af.tenant_id = gds.tenant_id
     AND af.data_source_id = gds.data_source_id
     AND af.deleted_at IS NULL
  )`;

/** 使用具体 Repository 的表名解析器构造 schema 限定的可见音频 CTE。 */
export function scopedVisibleAudioCte(table: (name: string) => string): string {
  return visibleAudioCte
    .replaceAll('group_audio_links', table('group_audio_links'))
    .replaceAll('group_data_sources', table('group_data_sources'))
    .replaceAll('__active_data_sources__', table('data_sources'))
    .replaceAll('audio_files', table('audio_files'));
}
