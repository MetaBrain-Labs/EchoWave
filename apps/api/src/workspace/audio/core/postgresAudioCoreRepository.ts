/**
 * 音频核心 PostgreSQL Repository。
 *
 * 负责播放元数据、分组访问校验和当前已发布分析详情恢复。
 *
 * Responsibilities:
 * - 隔离音频核心 Service 与工作区目录 SQL。
 * - 恢复当前转写、后分析和确认状态投影。
 *
 * Notes:
 * - 不领取或执行转写、后分析和业务分析任务。
 */
import {
  AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
  AudioAnalysisDetailSchema,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';
import { WorkspaceRepositoryError } from '../../errors.ts';
import { integer, iso } from './projection.ts';
import type { AudioCoreRepository, AudioPlaybackSource } from './repository.ts';

/** 为当前租户实现音频核心读取端口。 */
export class PostgresAudioCoreRepository implements AudioCoreRepository {
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

  async getAudioPlaybackSource(audioFileId: string): Promise<AudioPlaybackSource> {
    const result = await this.pool.query(
      `SELECT storage_key, mime_type, original_filename, upload_status
       FROM ${this.table('audio_files')}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [this.tenantId, audioFileId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '音频不存在或已归档。');
    if (row.upload_status !== 'ready' || !row.storage_key) {
      throw new WorkspaceRepositoryError('CONFLICT', '音频尚未完成上传，当前无法播放。');
    }
    return {
      storageKey: String(row.storage_key),
      mimeType: String(row.mime_type ?? 'application/octet-stream'),
      originalFilename: String(row.original_filename ?? 'audio'),
    };
  }

  /** 校验活动分组是否能通过显式分享或已关联数据源访问指定音频。 */
  async assertGroupAudioAccess(groupId: string, audioFileId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT 1
       FROM ${this.table('groups')} g
       JOIN ${this.table('audio_files')} af
         ON af.tenant_id = g.tenant_id AND af.id = $3 AND af.deleted_at IS NULL
       WHERE g.tenant_id = $1 AND g.id = $2 AND g.deleted_at IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM ${this.table('group_audio_links')} gal
             WHERE gal.tenant_id = af.tenant_id AND gal.group_id = g.id
               AND gal.audio_file_id = af.id
           ) OR EXISTS (
             SELECT 1 FROM ${this.table('group_data_sources')} gds
             JOIN ${this.table('data_sources')} ds
               ON ds.tenant_id = gds.tenant_id AND ds.id = gds.data_source_id
              AND ds.deleted_at IS NULL
             WHERE gds.tenant_id = af.tenant_id AND gds.group_id = g.id
               AND gds.data_source_id = af.data_source_id
           )
         )`,
      [this.tenantId, groupId, audioFileId],
    );
    if (!result.rowCount) {
      throw new WorkspaceRepositoryError('NOT_FOUND', '当前分组无法访问该音频。');
    }
  }

  async getAudioAnalysis(audioFileId: string) {
    const head = await this.pool.query(
      `SELECT ar.id, ar.audio_file_id, ar.revision_no, ar.published_at,
              ar.transcription_model, ar.settings_snapshot,
              ar.active_emotion_job_id, ar.active_role_job_id,
              ar.active_transcript_confirmation_id,
              tc.version_no AS confirmation_version, tc.confirmed_at,
              af.title, coalesce(af.duration_ms, 0)::bigint AS duration_ms
       FROM ${this.table('audio_files')} af
       JOIN ${this.table('audio_analysis_revisions')} ar
         ON ar.tenant_id = af.tenant_id AND ar.id = af.active_analysis_revision_id
       LEFT JOIN ${this.table('transcript_confirmations')} tc
         ON tc.tenant_id = ar.tenant_id AND tc.id = ar.active_transcript_confirmation_id
       WHERE af.tenant_id = $1 AND af.id = $2 AND af.deleted_at IS NULL AND ar.status = 'ready'`,
      [this.tenantId, audioFileId],
    );
    const row = head.rows[0];
    if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '音频分析不存在。');

    const [segments, invalidSegments, summaries, postAnalysisJobs] = await Promise.all([
      this.pool.query(
        `SELECT s.id AS scene_id, s.scene_index, s.title AS scene_title, s.start_ms AS scene_start_ms,
                ts.id AS segment_id, ts.segment_index, ts.speaker_key, ts.speaker_label,
                ts.business_role, ts.emotion, ts.start_ms, ts.end_ms,
                ts.text AS raw_text, tcs.text AS confirmed_text,
                tag.id AS tag_id, tag.title AS tag_title, tag.summary AS tag_summary, tag.details,
                er.emotion_label, er.confidence AS emotion_confidence,
                er.attitude, er.arousal, er.pace, er.volume_trend,
                er.pitch_variation, er.pause_pattern, er.vocal_cues,
                ej.model AS emotion_model,
                rr.role_kind, rr.role_label, rr.confidence AS role_confidence,
                rr.evidence_segment_ids, rj.model AS role_model
         FROM ${this.table('analysis_scenes')} s
         LEFT JOIN ${this.table('transcript_segments')} ts
           ON ts.tenant_id = s.tenant_id AND ts.scene_id = s.id
         LEFT JOIN ${this.table('segment_ai_tags')} tag
           ON tag.tenant_id = ts.tenant_id AND tag.transcript_segment_id = ts.id
         LEFT JOIN ${this.table('transcript_confirmation_segments')} tcs
           ON tcs.tenant_id = ts.tenant_id AND tcs.transcript_segment_id = ts.id
          AND tcs.transcript_confirmation_id = $5
         LEFT JOIN ${this.table('segment_emotion_results')} er
           ON er.tenant_id = ts.tenant_id AND er.job_id = $3
          AND er.transcript_segment_id = ts.id
         LEFT JOIN ${this.table('audio_post_analysis_jobs')} ej
           ON ej.tenant_id = er.tenant_id AND ej.id = er.job_id
         LEFT JOIN ${this.table('speaker_role_results')} rr
           ON rr.tenant_id = ts.tenant_id AND rr.job_id = $4
          AND rr.speaker_key = ts.speaker_key
         LEFT JOIN ${this.table('audio_post_analysis_jobs')} rj
           ON rj.tenant_id = rr.tenant_id AND rj.id = rr.job_id
         WHERE s.tenant_id = $1 AND s.analysis_revision_id = $2
         ORDER BY s.scene_index, ts.segment_index`,
        [
          this.tenantId,
          row.id,
          row.active_emotion_job_id,
          row.active_role_job_id,
          row.active_transcript_confirmation_id,
        ],
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
      this.pool.query(
        `SELECT DISTINCT ON (job.analysis_type)
                job.id, job.analysis_type, job.model, job.status, job.progress,
                job.completed_at, job.error_code, job.error_message, job.error_retryable,
                tc.version_no AS confirmation_version
         FROM ${this.table('audio_post_analysis_jobs')} job
         JOIN ${this.table('transcript_confirmations')} tc
           ON tc.tenant_id = job.tenant_id AND tc.id = job.transcript_confirmation_id
         WHERE job.tenant_id = $1 AND job.analysis_revision_id = $2
         ORDER BY job.analysis_type, job.created_at DESC`,
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
          businessRole: item.role_label ?? item.business_role,
          emotion: item.emotion_label ?? item.emotion,
          roleAnalysis: item.role_label
            ? {
                kind: item.role_kind,
                label: item.role_label,
                confidence: Number(item.role_confidence),
                evidenceSegmentIds: item.evidence_segment_ids,
                model: item.role_model,
              }
            : null,
          emotionAnalysis: item.emotion_label
            ? {
                label: item.emotion_label,
                confidence: Number(item.emotion_confidence),
                attitude: item.attitude,
                arousal: item.arousal,
                pace: item.pace,
                volumeTrend: item.volume_trend,
                pitchVariation: item.pitch_variation,
                pausePattern: item.pause_pattern,
                vocalCues: item.vocal_cues,
                model: item.emotion_model,
              }
            : null,
          startMs: integer(item.start_ms),
          endMs: integer(item.end_ms),
          rawText: item.raw_text,
          confirmedText: item.confirmed_text ?? null,
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

    const settings: Record<string, unknown> =
      row.settings_snapshot && typeof row.settings_snapshot === 'object'
        ? (row.settings_snapshot as Record<string, unknown>)
        : {};
    const capability = AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES.find(
      ({ id }) => id === row.transcription_model,
    );
    const speakerKeys = new Set(
      segments.rows.filter((item) => item.segment_id).map((item) => String(item.speaker_key)),
    );
    const observedSetting = settings.diarizationObserved;
    const diarizationRequested =
      settings.diarizationRequested === true || settings.speakerDiarization === true;
    const diarizationSupported = capability?.diarization ?? diarizationRequested;
    const diarizationStatus =
      !diarizationSupported || !diarizationRequested
        ? 'not_supported'
        : observedSetting === true || (observedSetting === undefined && speakerKeys.size > 1)
          ? 'observed'
          : 'not_returned';
    const responseGranularity =
      typeof settings.responseGranularity === 'string' &&
      ['word', 'segment', 'chunk', 'mixed'].includes(settings.responseGranularity)
        ? settings.responseGranularity
        : null;
    const segmentationMode =
      settings.segmentationMode === 'speaker_turn' ? 'speaker_turn' : 'readable';
    const speakerIdentityScope =
      settings.speakerIdentityScope === 'recording' || settings.speakerIdentityScope === 'chunk'
        ? settings.speakerIdentityScope
        : 'none';
    const preprocessingMode =
      settings.preprocessingMode === 'silero_vad' ? 'silero_vad' : 'whole_file';

    const postAnalysisState = (type: 'emotion' | 'role') => {
      const job = postAnalysisJobs.rows.find((item) => item.analysis_type === type);
      if (!job) return { state: 'idle' as const };
      if (job.status === 'queued' || job.status === 'running') {
        return {
          state: job.status,
          jobId: job.id,
          model: job.model,
          progress: integer(job.progress),
          confirmationVersion: integer(job.confirmation_version),
        };
      }
      if (job.status === 'ready') {
        return {
          state: 'ready' as const,
          jobId: job.id,
          model: job.model,
          completedAt: iso(job.completed_at),
          confirmationVersion: integer(job.confirmation_version),
        };
      }
      return {
        state: 'failed' as const,
        jobId: job.id,
        model: job.model,
        code: String(job.error_code ?? 'ANALYSIS_FAILED'),
        message: String(job.error_message ?? '分析失败。'),
        retryable: Boolean(job.error_retryable),
        confirmationVersion: integer(job.confirmation_version),
      };
    };

    return AudioAnalysisDetailSchema.parse({
      id: row.id,
      audioFileId: row.audio_file_id,
      revision: row.revision_no,
      title: row.title,
      durationMs: integer(row.duration_ms),
      generatedAt: iso(row.published_at),
      transcription: {
        model: row.transcription_model,
        language: typeof settings.language === 'string' ? settings.language : 'undetermined',
        diarizationStatus,
        responseGranularity,
        segmentationMode,
        speakerIdentityScope,
        preprocessingMode,
      },
      transcriptConfirmation: row.active_transcript_confirmation_id
        ? {
            status: 'confirmed',
            currentVersion: integer(row.confirmation_version),
            confirmedAt: iso(row.confirmed_at),
          }
        : { status: 'pending', currentVersion: 0, confirmedAt: null },
      postAnalysis: {
        emotion: postAnalysisState('emotion'),
        role: postAnalysisState('role'),
      },
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
