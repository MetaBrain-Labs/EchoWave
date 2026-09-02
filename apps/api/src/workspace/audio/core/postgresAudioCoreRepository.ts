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

  /** 删除当前活动分析修订中的一个已人工确认无误的说话人疑点。 */
  async resolveSpeakerReviewFinding(audioFileId: string, findingId: string): Promise<number> {
    const result = await this.pool.query(
      `WITH target_audio AS MATERIALIZED (
         SELECT active_analysis_revision_id
         FROM ${this.table('audio_files')}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       ), resolved AS (
         DELETE FROM ${this.table('speaker_review_findings')} finding
         WHERE finding.tenant_id = $1
           AND finding.id = $3
           AND finding.analysis_revision_id = (
             SELECT active_analysis_revision_id FROM target_audio
         )
         RETURNING 1
       ), marked AS (
         UPDATE ${this.table('audio_analysis_revisions')} revision
         SET speaker_review_resolved_at = CASE
           WHEN NOT EXISTS (
             SELECT 1
             FROM ${this.table('speaker_review_findings')} pending
             WHERE pending.tenant_id = $1
               AND pending.analysis_revision_id = revision.id
               AND pending.source_transcript_segment_id IS NOT NULL
               AND pending.id <> $3
           ) THEN now()
           ELSE NULL
         END
         WHERE revision.tenant_id = $1
           AND revision.id = (SELECT active_analysis_revision_id FROM target_audio)
           AND EXISTS (
             SELECT 1
             FROM ${this.table('speaker_review_findings')} target
             WHERE target.tenant_id = $1 AND target.analysis_revision_id = revision.id
               AND target.id = $3
           )
         RETURNING 1
       )
       SELECT EXISTS (SELECT 1 FROM target_audio) AS audio_exists,
              (SELECT count(*)::integer FROM resolved) AS resolved_count`,
      [this.tenantId, audioFileId, findingId],
    );
    const row = result.rows[0];
    if (!row?.audio_exists) {
      throw new WorkspaceRepositoryError('NOT_FOUND', '音频不存在或已归档。');
    }
    return integer(row.resolved_count);
  }

  /** 删除当前活动分析修订中全部已人工确认无误的说话人疑点。 */
  async resolveAllSpeakerReviewFindings(audioFileId: string): Promise<number> {
    const result = await this.pool.query(
      `WITH target_audio AS MATERIALIZED (
         SELECT active_analysis_revision_id
         FROM ${this.table('audio_files')}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       ), resolved AS (
         DELETE FROM ${this.table('speaker_review_findings')} finding
         WHERE finding.tenant_id = $1
           AND finding.analysis_revision_id = (
             SELECT active_analysis_revision_id FROM target_audio
         )
         RETURNING 1
       ), marked AS (
         UPDATE ${this.table('audio_analysis_revisions')} revision
         SET speaker_review_resolved_at = now()
         WHERE revision.tenant_id = $1
           AND revision.id = (SELECT active_analysis_revision_id FROM target_audio)
         RETURNING 1
       )
       SELECT EXISTS (SELECT 1 FROM target_audio) AS audio_exists,
              (SELECT count(*)::integer FROM resolved) AS resolved_count`,
      [this.tenantId, audioFileId],
    );
    const row = result.rows[0];
    if (!row?.audio_exists) {
      throw new WorkspaceRepositoryError('NOT_FOUND', '音频不存在或已归档。');
    }
    return integer(row.resolved_count);
  }

  async getAudioAnalysis(audioFileId: string) {
    const head = await this.pool.query(
      `SELECT ar.id, ar.audio_file_id, ar.revision_no, ar.published_at,
              ar.transcription_model, ar.settings_snapshot,
              ar.active_emotion_job_id, ar.active_role_job_id,
              ar.active_transcript_confirmation_id,
              ar.speaker_review_resolved_at,
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

    const [
      rawSegments,
      confirmedSegments,
      reviewFindings,
      reviewJob,
      invalidSegments,
      summaries,
      postAnalysisJobs,
    ] = await Promise.all([
      this.pool.query(
        `SELECT s.id AS scene_id, s.scene_index, s.title AS scene_title, s.start_ms AS scene_start_ms,
                 ts.id AS segment_id, ts.segment_index, ts.speaker_key, ts.speaker_label,
                 ts.business_role, ts.emotion, ts.start_ms, ts.end_ms,
                 ts.text AS raw_text, ts.words,
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
        `SELECT s.id AS scene_id, s.scene_index, s.title AS scene_title,
                s.start_ms AS scene_start_ms, confirmed.confirmed_segment_id AS segment_id,
                confirmed.part_index AS segment_index, confirmed.speaker_key,
                confirmed.start_word_index, confirmed.end_word_index,
                confirmed.start_ms, confirmed.end_ms, confirmed.text AS confirmed_text,
                raw.id AS source_segment_id, raw.text AS raw_text, raw.words,
                er.emotion_label, er.confidence AS emotion_confidence,
                er.attitude, er.arousal, er.pace, er.volume_trend,
                er.pitch_variation, er.pause_pattern, er.vocal_cues,
                ej.model AS emotion_model,
                rr.role_kind, rr.role_label, rr.confidence AS role_confidence,
                rr.evidence_segment_ids, rj.model AS role_model
         FROM ${this.table('transcript_confirmation_segments')} confirmed
         JOIN ${this.table('transcript_segments')} raw
           ON raw.tenant_id = confirmed.tenant_id
          AND raw.analysis_revision_id = confirmed.analysis_revision_id
          AND raw.id = confirmed.source_transcript_segment_id
         JOIN ${this.table('analysis_scenes')} s
           ON s.tenant_id = raw.tenant_id AND s.id = raw.scene_id
         LEFT JOIN ${this.table('audio_post_analysis_jobs')} ej
           ON ej.tenant_id = confirmed.tenant_id AND ej.id = $2
          AND ej.transcript_confirmation_id = confirmed.transcript_confirmation_id
         LEFT JOIN ${this.table('segment_emotion_results')} er
           ON er.tenant_id = confirmed.tenant_id AND er.job_id = ej.id
          AND er.transcript_confirmation_id = confirmed.transcript_confirmation_id
          AND er.confirmed_segment_id = confirmed.confirmed_segment_id
         LEFT JOIN ${this.table('audio_post_analysis_jobs')} rj
           ON rj.tenant_id = confirmed.tenant_id AND rj.id = $3
          AND rj.transcript_confirmation_id = confirmed.transcript_confirmation_id
         LEFT JOIN ${this.table('speaker_role_results')} rr
           ON rr.tenant_id = confirmed.tenant_id AND rr.job_id = rj.id
          AND rr.speaker_key = confirmed.speaker_key
         WHERE confirmed.tenant_id = $1 AND confirmed.transcript_confirmation_id = $4
         ORDER BY s.scene_index, confirmed.part_index`,
        [
          this.tenantId,
          row.active_emotion_job_id,
          row.active_role_job_id,
          row.active_transcript_confirmation_id,
        ],
      ),
      this.pool.query(
        `SELECT id, source_transcript_segment_id, split_after_word_index, kind, severity,
                reason_code, explanation, finding_source
         FROM ${this.table('speaker_review_findings')}
         WHERE tenant_id = $1 AND analysis_revision_id = $2
         ORDER BY created_at, id`,
        [this.tenantId, row.id],
      ),
      this.pool.query(
        `SELECT status, model, error_message
         FROM ${this.table('audio_speaker_review_jobs')}
         WHERE tenant_id = $1 AND analysis_revision_id = $2`,
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
      this.pool.query(
        `SELECT DISTINCT ON (job.analysis_type)
                job.id, job.analysis_type, job.model, job.status, job.progress,
                job.completed_at, job.error_code, job.error_message, job.error_retryable,
                tc.version_no AS confirmation_version
         FROM ${this.table('audio_post_analysis_jobs')} job
         JOIN ${this.table('transcript_confirmations')} tc
           ON tc.tenant_id = job.tenant_id AND tc.id = job.transcript_confirmation_id
         WHERE job.tenant_id = $1 AND job.analysis_revision_id = $2
           AND job.transcript_confirmation_id = $3
         ORDER BY job.analysis_type, job.created_at DESC`,
        [this.tenantId, row.id, row.active_transcript_confirmation_id],
      ),
    ]);

    const mappedFindings = reviewFindings.rows.map((finding) => ({
      id: finding.id,
      sourceSegmentId: finding.source_transcript_segment_id ?? null,
      splitAfterWordIndex:
        finding.split_after_word_index === null ? null : integer(finding.split_after_word_index),
      kind: finding.kind,
      severity: finding.severity,
      reasonCode: finding.reason_code,
      explanation: finding.explanation,
      source: finding.finding_source,
    }));
    const rawScenes = new Map<string, any>();
    for (const item of rawSegments.rows) {
      let scene = rawScenes.get(item.scene_id);
      if (!scene) {
        scene = {
          id: item.scene_id,
          index: item.scene_index,
          title: item.scene_title,
          startMs: integer(item.scene_start_ms),
          segments: [],
        };
        rawScenes.set(item.scene_id, scene);
      }
      if (item.segment_id) {
        scene.segments.push({
          id: item.segment_id,
          index: item.segment_index,
          speakerKey: item.speaker_key,
          speakerLabel: item.speaker_label,
          businessRole: item.business_role,
          emotion: item.emotion,
          roleAnalysis: null,
          emotionAnalysis: null,
          startMs: integer(item.start_ms),
          endMs: integer(item.end_ms),
          rawText: item.raw_text,
          confirmedText: null,
          sourceSegmentId: item.segment_id,
          startWordIndex: 0,
          endWordIndex:
            Array.isArray(item.words) && item.words.length > 0 ? item.words.length : null,
          words: Array.isArray(item.words) ? item.words : [],
          reviewFindings: mappedFindings.filter(
            (finding) => finding.sourceSegmentId === item.segment_id,
          ),
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

    const confirmedScenesMap = new Map<string, any>();
    for (const item of confirmedSegments.rows) {
      let scene = confirmedScenesMap.get(item.scene_id);
      if (!scene) {
        scene = {
          id: item.scene_id,
          index: item.scene_index,
          title: item.scene_title,
          startMs: integer(item.scene_start_ms),
          segments: [],
        };
        confirmedScenesMap.set(item.scene_id, scene);
      }
      const sourceWords = Array.isArray(item.words) ? item.words : [];
      const startWordIndex =
        item.start_word_index === null || item.start_word_index === undefined
          ? 0
          : integer(item.start_word_index);
      const endWordIndex =
        item.end_word_index === null || item.end_word_index === undefined
          ? Math.max(sourceWords.length, 1)
          : integer(item.end_word_index);
      const segmentFindings = mappedFindings.filter(
        (finding) =>
          finding.sourceSegmentId === item.source_segment_id &&
          finding.splitAfterWordIndex !== null &&
          finding.splitAfterWordIndex >= startWordIndex &&
          finding.splitAfterWordIndex < endWordIndex,
      );
      scene.segments.push({
        id: item.segment_id,
        index: item.segment_index,
        speakerKey: item.speaker_key,
        speakerLabel: item.speaker_key,
        businessRole: item.role_label ?? 'unknown',
        emotion: item.emotion_label ?? 'unknown',
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
        confirmedText: item.confirmed_text,
        sourceSegmentId: item.source_segment_id,
        startWordIndex,
        endWordIndex,
        words: sourceWords.slice(startWordIndex, endWordIndex),
        reviewFindings: segmentFindings,
        aiTag: null,
      });
    }
    const handledReviewBoundaries = new Set(
      [...confirmedScenesMap.values()].flatMap((scene) =>
        scene.segments
          .filter((segment: any) => segment.startWordIndex > 0)
          .map(
            (segment: any) => `${segment.sourceSegmentId}:${Number(segment.startWordIndex) - 1}`,
          ),
      ),
    );
    for (const scene of confirmedScenesMap.values()) {
      for (const segment of scene.segments) {
        segment.reviewFindings = segment.reviewFindings.filter(
          (finding: { sourceSegmentId: string; splitAfterWordIndex: number }) =>
            !handledReviewBoundaries.has(
              `${finding.sourceSegmentId}:${finding.splitAfterWordIndex}`,
            ),
        );
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
      rawSegments.rows.filter((item) => item.segment_id).map((item) => String(item.speaker_key)),
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
        expectedSpeakerCount:
          typeof settings.expectedSpeakerCount === 'number' ? settings.expectedSpeakerCount : null,
      },
      speakerReview: (() => {
        const job = reviewJob.rows[0];
        if (!job) {
          return {
            status: 'partial' as const,
            model: null,
            message: '智能说话人复核未配置；当前仅显示本地规则结果。',
            resolvedAt: row.speaker_review_resolved_at ? iso(row.speaker_review_resolved_at) : null,
            findings: mappedFindings,
          };
        }
        if (job.status === 'queued' || job.status === 'running') {
          return {
            status: 'running' as const,
            model: job.model,
            message: null,
            resolvedAt: row.speaker_review_resolved_at ? iso(row.speaker_review_resolved_at) : null,
            findings: mappedFindings,
          };
        }
        if (job.status === 'ready') {
          return {
            status: 'ready' as const,
            model: job.model,
            message: null,
            resolvedAt: row.speaker_review_resolved_at ? iso(row.speaker_review_resolved_at) : null,
            findings: mappedFindings,
          };
        }
        return {
          status: 'partial' as const,
          model: job.model,
          message: String(job.error_message ?? '智能说话人复核未完成。'),
          resolvedAt: row.speaker_review_resolved_at ? iso(row.speaker_review_resolved_at) : null,
          findings: mappedFindings,
        };
      })(),
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
      scenes:
        row.active_transcript_confirmation_id && confirmedScenesMap.size > 0
          ? [...confirmedScenesMap.values()]
          : [...rawScenes.values()],
      rawScenes: [...rawScenes.values()],
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
