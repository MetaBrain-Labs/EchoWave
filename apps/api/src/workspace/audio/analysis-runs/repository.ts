/**
 * 统一分析运行记录查询仓储。
 *
 * 从自动批次任务、ASR 修订及其后置/业务分析子任务聚合只读列表，避免移动端维护第二套状态源。
 *
 * Responsibilities:
 * - 按租户、状态和类型查询最近分析运行记录。
 * - 排除已被自动批次引用的修订，避免手动记录重复展示。
 *
 * Notes:
 * - PostgreSQL 是唯一状态源；本仓储不写入任何任务状态。
 */
import {
  AudioAnalysisRunsResponseSchema,
  type AudioAnalysisRun,
  type AudioAnalysisRunsQuery,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';

type RawBatch = {
  id: string;
  group_id: string;
  group_name: string;
  scheduled_for: Date | string | null;
  updated_at: Date | string;
  total: number;
  active: number;
  blocked: number;
  completed: number;
  partial: number;
  failed: number;
  canceled: number;
  progress: number;
  scheduled_count: number;
};

type RawManual = {
  audio_file_id: string;
  title: string;
  group_id: string | null;
  revision_id: string;
  revision_status: string;
  revision_progress: number;
  revision_error_code: string | null;
  revision_error_message: string | null;
  revision_error_retryable: boolean | null;
  revision_updated_at: Date | string;
  emotion_status: string | null;
  emotion_error_code: string | null;
  role_status: string | null;
  role_error_code: string | null;
  business_status: string | null;
  business_id: string | null;
  business_head_job_id: string | null;
  business_progress: number | null;
  business_error_code: string | null;
  business_error_message: string | null;
  business_error_retryable: boolean | null;
  business_limitations: unknown;
  speaker_status: string | null;
  speaker_finding_count: number;
};

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function batchStatus(row: RawBatch): AudioAnalysisRun['status'] {
  if (row.active > 0) return row.scheduled_count === row.active ? 'scheduled' : 'running';
  if (row.blocked > 0) return 'hard_blocked';
  if (row.failed > 0) return 'failed';
  if (row.partial > 0) return 'completed_with_warnings';
  if (row.canceled === row.total && row.total > 0) return 'canceled';
  return 'completed';
}

function matchesStatus(
  status: AudioAnalysisRun['status'],
  filter: AudioAnalysisRunsQuery['status'],
) {
  if (filter === 'all') return true;
  if (filter === 'active')
    return ['awaiting_upload', 'scheduled', 'queued', 'running', 'hard_blocked'].includes(status);
  if (filter === 'completed') return status === 'completed';
  if (filter === 'warning') return status === 'completed_with_warnings';
  return status === filter;
}

/** 统一分析运行记录的 PostgreSQL 只读查询。 */
export class AudioAnalysisRunsRepository {
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

  async list(query: AudioAnalysisRunsQuery): Promise<{ items: AudioAnalysisRun[] }> {
    const items: AudioAnalysisRun[] = [];
    if (query.kind === 'all' || query.kind === 'batch') {
      const batches = await this.pool.query<RawBatch>(
        `SELECT batch.id, batch.group_id, group_row.name AS group_name, batch.scheduled_for,
                greatest(batch.updated_at, coalesce(max(task.updated_at), batch.updated_at)) AS updated_at,
                count(task.id)::int AS total,
                count(task.id) FILTER (WHERE task.status IN ('awaiting_upload','scheduled','queued','running'))::int AS active,
                count(task.id) FILTER (WHERE task.status = 'hard_blocked')::int AS blocked,
                count(task.id) FILTER (WHERE task.status = 'completed')::int AS completed,
                count(task.id) FILTER (WHERE task.status = 'completed_with_warnings')::int AS partial,
                count(task.id) FILTER (WHERE task.status = 'failed')::int AS failed,
                count(task.id) FILTER (WHERE task.status = 'canceled')::int AS canceled,
                coalesce(avg(task.progress), 0)::int AS progress,
                count(task.id) FILTER (WHERE task.status = 'scheduled')::int AS scheduled_count
         FROM ${this.table('audio_analysis_batches')} batch
         JOIN ${this.table('groups')} group_row
           ON group_row.tenant_id = batch.tenant_id AND group_row.id = batch.group_id
         LEFT JOIN ${this.table('audio_analysis_tasks')} task
           ON task.tenant_id = batch.tenant_id AND task.batch_id = batch.id
         WHERE batch.tenant_id = $1
         GROUP BY batch.id, group_row.name
         ORDER BY updated_at DESC
         LIMIT 50`,
        [this.tenantId],
      );
      for (const row of batches.rows) {
        const status = batchStatus(row);
        if (!matchesStatus(status, query.status)) continue;
        items.push({
          kind: 'batch',
          id: row.id,
          title: row.group_name || '音频分析批次',
          groupId: row.group_id,
          status,
          progress: Math.max(0, Math.min(100, Number(row.progress))),
          scheduledFor: iso(row.scheduled_for),
          counts: {
            total: Number(row.total),
            active: Number(row.active),
            blocked: Number(row.blocked),
            completed: Number(row.completed),
            partial: Number(row.partial),
            failed: Number(row.failed),
            canceled: Number(row.canceled),
          },
          updatedAt: iso(row.updated_at)!,
        });
      }
    }
    if (query.kind === 'all' || query.kind === 'manual_audio') {
      const manual = await this.pool.query<RawManual>(
        `SELECT af.id AS audio_file_id, af.title,
                revision.id AS revision_id, revision.status AS revision_status,
                revision.progress AS revision_progress, revision.error_code AS revision_error_code,
                revision.error_message AS revision_error_message,
                revision.error_retryable AS revision_error_retryable,
                coalesce(revision.published_at, revision.completed_at, revision.created_at) AS revision_updated_at,
                coalesce(business.group_id, af.origin_group_id, group_link.group_id) AS group_id,
                emotion.status AS emotion_status, emotion.error_code AS emotion_error_code,
                role.status AS role_status, role.error_code AS role_error_code,
                business.id AS business_id, business.status AS business_status,
                business.head_job_id AS business_head_job_id, business.progress AS business_progress,
                business.error_code AS business_error_code, business.error_message AS business_error_message,
                business.error_retryable AS business_error_retryable,
                business.limitations AS business_limitations,
                speaker.status AS speaker_status, speaker.finding_count AS speaker_finding_count
         FROM ${this.table('audio_files')} af
         JOIN LATERAL (
           SELECT revision.*
           FROM ${this.table('audio_analysis_revisions')} revision
           WHERE revision.tenant_id = af.tenant_id AND revision.audio_file_id = af.id
             AND NOT EXISTS (
               SELECT 1 FROM ${this.table('audio_analysis_tasks')} task
               WHERE task.tenant_id = revision.tenant_id AND task.analysis_revision_id = revision.id
             )
           ORDER BY revision.created_at DESC LIMIT 1
         ) revision ON true
         LEFT JOIN LATERAL (
           SELECT link.group_id FROM ${this.table('group_audio_links')} link
           WHERE link.tenant_id = af.tenant_id AND link.audio_file_id = af.id
           ORDER BY link.created_at DESC LIMIT 1
         ) group_link ON true
         LEFT JOIN ${this.table('audio_post_analysis_jobs')} emotion
           ON emotion.tenant_id = revision.tenant_id AND emotion.id = revision.active_emotion_job_id
         LEFT JOIN ${this.table('audio_post_analysis_jobs')} role
           ON role.tenant_id = revision.tenant_id AND role.id = revision.active_role_job_id
         LEFT JOIN LATERAL (
           SELECT job.*, head.active_job_id AS head_job_id
           FROM ${this.table('audio_business_analysis_jobs')} job
           LEFT JOIN ${this.table('audio_group_business_analysis_heads')} head
             ON head.tenant_id = job.tenant_id AND head.group_id = job.group_id
            AND head.audio_file_id = job.audio_file_id
           WHERE job.tenant_id = revision.tenant_id AND job.analysis_revision_id = revision.id
           ORDER BY job.created_at DESC LIMIT 1
         ) business ON true
         LEFT JOIN LATERAL (
           SELECT review.status,
                  (SELECT count(*)::int FROM ${this.table('speaker_review_findings')} finding
                   WHERE finding.tenant_id = review.tenant_id
                     AND finding.analysis_revision_id = review.analysis_revision_id) AS finding_count
           FROM ${this.table('audio_speaker_review_jobs')} review
           WHERE review.tenant_id = revision.tenant_id AND review.analysis_revision_id = revision.id
           LIMIT 1
         ) speaker ON true
         WHERE af.tenant_id = $1 AND af.deleted_at IS NULL AND af.upload_status = 'ready'
         ORDER BY revision_updated_at DESC
         LIMIT 50`,
        [this.tenantId],
      );
      for (const row of manual.rows) {
        const optionalFailed = [row.emotion_status, row.role_status].some(
          (status) => status === 'failed',
        );
        const activePost = [row.emotion_status, row.role_status, row.business_status].some(
          (status) => ['queued', 'running'].includes(status ?? ''),
        );
        const failed = row.revision_status === 'failed' || row.business_status === 'failed';
        const status: AudioAnalysisRun['status'] = activePost
          ? 'running'
          : failed
            ? 'failed'
            : optionalFailed || strings(row.business_limitations).length > 0
              ? 'completed_with_warnings'
              : 'completed';
        if (!matchesStatus(status, query.status)) continue;
        const phase =
          row.revision_status !== 'ready'
            ? 'transcription'
            : row.emotion_status === 'queued' ||
                row.emotion_status === 'running' ||
                row.role_status === 'queued' ||
                row.role_status === 'running'
              ? 'post_analysis'
              : row.business_status === 'queued' || row.business_status === 'running'
                ? 'business_analysis'
                : 'done';
        const progress =
          row.revision_status !== 'ready'
            ? Number(row.revision_progress)
            : row.business_status
              ? 75 + Math.round(Number(row.business_progress ?? 0) * 0.25)
              : 100;
        const errorCode = row.revision_error_code ?? row.business_error_code;
        const errorMessage = row.revision_error_message ?? row.business_error_message;
        items.push({
          kind: 'manual_audio',
          id: row.revision_id,
          audioFileId: row.audio_file_id,
          groupId: row.group_id,
          title: row.title,
          status,
          phase,
          progress: Math.max(0, Math.min(100, progress)),
          reportAvailable:
            row.business_status === 'ready' && row.business_head_job_id === row.business_id,
          warningCodes: [
            ...(optionalFailed ? ['POST_ANALYSIS_UNAVAILABLE'] : []),
            ...(row.speaker_status === 'failed' ? ['SPEAKER_REVIEW_UNAVAILABLE'] : []),
            ...(Number(row.speaker_finding_count ?? 0) > 0 ? ['SPEAKER_REVIEW_REQUIRED'] : []),
            ...strings(row.business_limitations),
          ],
          error:
            errorCode && errorMessage
              ? {
                  code: errorCode,
                  message: errorMessage,
                  retryable: Boolean(row.revision_error_retryable ?? row.business_error_retryable),
                }
              : null,
          updatedAt: iso(row.revision_updated_at)!,
        });
      }
    }
    items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return AudioAnalysisRunsResponseSchema.parse({ items: items.slice(0, query.limit) });
  }
}
