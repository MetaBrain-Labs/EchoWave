/**
 * 分组级销售复盘任务仓储。
 *
 * 将确认转写、分组设置、知识库白名单和可选后置识别结果冻结为任务快照，并以
 * “音频 + 分组”发布头保证失败重跑不会覆盖上一份成功结果。
 *
 * Responsibilities:
 * - 创建、幂等复用、领取和推进业务分析任务。
 * - 原子保存总结、标签、多片段证据与知识引用。
 * - 恢复当前任务状态和已发布结果。
 *
 * Notes:
 * - 所有访问均固定在当前租户，任务错误字段不保存转写或模型原文。
 */
import { createHash } from 'node:crypto';

import {
  AudioBusinessAnalysisStartResponseSchema,
  AudioBusinessAnalysisStateSchema,
  DEFAULT_GROUP_ANALYSIS_FOCUS,
  DEFAULT_GROUP_ANALYSIS_TONE,
  type BusinessAnalysisTagCategory,
} from '@echowave/contracts';
import type { PoolClient } from 'pg';

import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';
import type { RetrievalChunk } from '../../../knowledge/retrieval/types.ts';
import { WorkspaceRepositoryError } from '../../errors.ts';

export const BUSINESS_ANALYSIS_WORKFLOW_VERSION = 'langgraph-v1';
export const BUSINESS_ANALYSIS_MAX_RECOVERY_ATTEMPTS = 2;

export type BusinessAnalysisSegment = {
  id: string;
  speakerKey: string;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  role: null | { label: string; confidence: number };
  emotion: null | { label: string; confidence: number; attitude: string };
};

export type BusinessAnalysisSettingsSnapshot = {
  timing: 'automatic' | 'manual';
  contentFocus: string;
  tone: string;
  customTags: string[];
  settingsUpdatedAt: string | null;
};

export type ClaimedBusinessAnalysisJob = {
  id: string;
  audioFileId: string;
  groupId: string;
  revisionId: string;
  confirmationId: string;
  confirmationVersion: number;
  model: string;
  workflowVersion: string;
  recoveryAttempts: number;
  knowledgeBaseIds: string[];
  knowledgeBases: { id: string; name: string }[];
  settings: BusinessAnalysisSettingsSnapshot;
  segments: BusinessAnalysisSegment[];
};

export type BusinessAnalysisPublication = {
  limitations: string[];
  summarySections: { title: string; body: string }[];
  tags: {
    category: BusinessAnalysisTagCategory;
    customLabel: string | null;
    title: string;
    summary: string;
    details: string[];
    confidence: number;
    evidenceSegmentIds: string[];
    citedChunkIds: string[];
  }[];
};

type SourceSnapshot = {
  audioFileId: string;
  groupId: string;
  revisionId: string;
  confirmationId: string;
  confirmationVersion: number;
  knowledgeBaseIds: string[];
  emotionJobId: string | null;
  roleJobId: string | null;
  settings: BusinessAnalysisSettingsSnapshot;
  fingerprint: string;
};

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function safeArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function comparableSettings(settings: BusinessAnalysisSettingsSnapshot) {
  return {
    timing: settings.timing,
    contentFocus: settings.contentFocus,
    tone: settings.tone,
    customTags: settings.customTags,
  };
}

/** 管理分组销售复盘的不可变任务与发布结果。 */
export class BusinessAnalysisRepository {
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

  private async sourceSnapshot(
    audioFileId: string,
    groupId: string,
    client: DatabasePool | PoolClient = this.pool,
  ): Promise<SourceSnapshot> {
    const source = await client.query(
      `SELECT af.id AS audio_file_id, ar.id AS revision_id,
              ar.active_transcript_confirmation_id AS confirmation_id,
              tc.version_no AS confirmation_version,
              s.updated_at AS settings_updated_at,
              coalesce(s.analysis_timing, 'automatic') AS analysis_timing,
              coalesce(s.content_focus, $3) AS content_focus,
              coalesce(s.tone, $4) AS tone,
              coalesce(s.custom_tags, '[]'::jsonb) AS custom_tags,
              CASE WHEN ej.transcript_confirmation_id = tc.id AND ej.status = 'ready'
                THEN ar.active_emotion_job_id END AS emotion_job_id,
              CASE WHEN rj.transcript_confirmation_id = tc.id AND rj.status = 'ready'
                THEN ar.active_role_job_id END AS role_job_id
       FROM ${this.table('audio_files')} af
       JOIN ${this.table('audio_analysis_revisions')} ar
         ON ar.tenant_id = af.tenant_id AND ar.id = af.active_analysis_revision_id
       JOIN ${this.table('transcript_confirmations')} tc
         ON tc.tenant_id = ar.tenant_id AND tc.id = ar.active_transcript_confirmation_id
       JOIN ${this.table('groups')} g
         ON g.tenant_id = af.tenant_id AND g.id = $2 AND g.deleted_at IS NULL
       LEFT JOIN ${this.table('group_analysis_settings')} s
         ON s.tenant_id = g.tenant_id AND s.group_id = g.id
       LEFT JOIN ${this.table('audio_post_analysis_jobs')} ej
         ON ej.tenant_id = ar.tenant_id AND ej.id = ar.active_emotion_job_id
       LEFT JOIN ${this.table('audio_post_analysis_jobs')} rj
         ON rj.tenant_id = ar.tenant_id AND rj.id = ar.active_role_job_id
       WHERE af.tenant_id = $1 AND af.id = $5 AND af.deleted_at IS NULL
         AND ar.status = 'ready'
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
      [
        this.tenantId,
        groupId,
        DEFAULT_GROUP_ANALYSIS_FOCUS,
        DEFAULT_GROUP_ANALYSIS_TONE,
        audioFileId,
      ],
    );
    const row = source.rows[0];
    if (!row) {
      throw new WorkspaceRepositoryError(
        'CONFLICT',
        '音频不属于当前分组、尚无已发布转写，或转写尚未确认。',
      );
    }
    const links = await client.query(
      `SELECT gkb.knowledge_base_id
       FROM ${this.table('group_knowledge_bases')} gkb
       JOIN ${this.table('knowledge_bases')} kb
         ON kb.tenant_id = gkb.tenant_id AND kb.id = gkb.knowledge_base_id
        AND kb.deleted_at IS NULL
       WHERE gkb.tenant_id = $1 AND gkb.group_id = $2
       ORDER BY gkb.knowledge_base_id`,
      [this.tenantId, groupId],
    );
    const knowledgeBaseIds = links.rows.map((item) => String(item.knowledge_base_id));
    const settings: BusinessAnalysisSettingsSnapshot = {
      timing: row.analysis_timing,
      contentFocus: row.content_focus,
      tone: row.tone,
      customTags: safeArray(row.custom_tags),
      settingsUpdatedAt: row.settings_updated_at ? iso(row.settings_updated_at) : null,
    };
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          confirmationId: row.confirmation_id,
          emotionJobId: row.emotion_job_id ?? null,
          knowledgeBaseIds,
          roleJobId: row.role_job_id ?? null,
          settings: comparableSettings(settings),
        }),
      )
      .digest('hex');
    return {
      audioFileId,
      groupId,
      revisionId: row.revision_id,
      confirmationId: row.confirmation_id,
      confirmationVersion: Number(row.confirmation_version),
      knowledgeBaseIds,
      emotionJobId: row.emotion_job_id ?? null,
      roleJobId: row.role_job_id ?? null,
      settings,
      fingerprint,
    };
  }

  /** 创建业务分析任务；相同输入默认复用，强制重跑只在无进行中任务时创建新版本。 */
  async queue(audioFileId: string, groupId: string, model: string, force = false) {
    const client = await this.pool.connect();
    let snapshot: SourceSnapshot | undefined;
    try {
      await client.query('BEGIN');
      snapshot = await this.sourceSnapshot(audioFileId, groupId, client);
      const existing = await client.query(
        `SELECT id, status FROM ${this.table('audio_business_analysis_jobs')}
         WHERE tenant_id = $1 AND group_id = $2 AND audio_file_id = $3
           AND transcript_confirmation_id = $4 AND input_fingerprint = $5
           AND status IN ('queued', 'running', 'ready')
         ORDER BY created_at DESC LIMIT 1`,
        [this.tenantId, groupId, audioFileId, snapshot.confirmationId, snapshot.fingerprint],
      );
      if (existing.rows[0] && (!force || existing.rows[0].status !== 'ready')) {
        await client.query('COMMIT');
        return AudioBusinessAnalysisStartResponseSchema.parse({
          audioFileId,
          groupId,
          revisionId: snapshot.revisionId,
          jobId: existing.rows[0].id,
          status: existing.rows[0].status,
          reused: true,
        });
      }
      const created = await client.query(
        `INSERT INTO ${this.table('audio_business_analysis_jobs')}
           (tenant_id, group_id, audio_file_id, analysis_revision_id,
            transcript_confirmation_id, confirmation_version, model, input_fingerprint,
            settings_snapshot, knowledge_base_ids, emotion_job_id, role_job_id, status, progress,
            workflow_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::uuid[], $11, $12,
                 'queued', 0, $13)
         RETURNING id`,
        [
          this.tenantId,
          groupId,
          audioFileId,
          snapshot.revisionId,
          snapshot.confirmationId,
          snapshot.confirmationVersion,
          model,
          snapshot.fingerprint,
          JSON.stringify(snapshot.settings),
          snapshot.knowledgeBaseIds,
          snapshot.emotionJobId,
          snapshot.roleJobId,
          BUSINESS_ANALYSIS_WORKFLOW_VERSION,
        ],
      );
      await client.query('COMMIT');
      return AudioBusinessAnalysisStartResponseSchema.parse({
        audioFileId,
        groupId,
        revisionId: snapshot.revisionId,
        jobId: created.rows[0].id,
        status: 'queued',
        reused: false,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        const concurrent = await this.pool.query(
          `SELECT id, status FROM ${this.table('audio_business_analysis_jobs')}
           WHERE tenant_id = $1 AND group_id = $2 AND audio_file_id = $3
             AND status IN ('queued', 'running')
           ORDER BY created_at DESC LIMIT 1`,
          [this.tenantId, groupId, audioFileId],
        );
        if (concurrent.rows[0] && snapshot) {
          return AudioBusinessAnalysisStartResponseSchema.parse({
            audioFileId,
            groupId,
            revisionId: snapshot.revisionId,
            jobId: concurrent.rows[0].id,
            status: concurrent.rows[0].status,
            reused: true,
          });
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async resetInterrupted(): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_business_analysis_jobs')}
       SET status = 'queued', next_attempt_at = now(), completed_at = NULL
       WHERE tenant_id = $1 AND status = 'running'`,
      [this.tenantId],
    );
  }

  /** 领取最早任务并恢复确认版转写与同版本角色、情绪快照。 */
  async claim(): Promise<ClaimedBusinessAnalysisJob | undefined> {
    const claimed = await this.pool.query(
      `WITH candidate AS (
       SELECT id FROM ${this.table('audio_business_analysis_jobs')}
         WHERE tenant_id = $1 AND status = 'queued'
           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE ${this.table('audio_business_analysis_jobs')} job
       SET status = 'running', progress = greatest(progress, 1), next_attempt_at = NULL,
           error_code = NULL, error_message = NULL, error_retryable = NULL,
           checkpoint_cleanup_pending = true
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING job.*`,
      [this.tenantId],
    );
    const row = claimed.rows[0];
    if (!row) return undefined;
    const segments = await this.pool.query(
      `SELECT ts.id, ts.speaker_key, ts.speaker_label, ts.start_ms, ts.end_ms, confirmed.text,
              rr.role_label, rr.confidence AS role_confidence,
              er.emotion_label, er.confidence AS emotion_confidence, er.attitude
       FROM ${this.table('transcript_confirmation_segments')} confirmed
       JOIN ${this.table('transcript_segments')} ts
         ON ts.tenant_id = confirmed.tenant_id
        AND ts.analysis_revision_id = confirmed.analysis_revision_id
        AND ts.id = confirmed.transcript_segment_id
       LEFT JOIN ${this.table('speaker_role_results')} rr
         ON rr.tenant_id = ts.tenant_id AND rr.job_id = $3 AND rr.speaker_key = ts.speaker_key
       LEFT JOIN ${this.table('segment_emotion_results')} er
         ON er.tenant_id = ts.tenant_id AND er.job_id = $4 AND er.transcript_segment_id = ts.id
       WHERE confirmed.tenant_id = $1 AND confirmed.transcript_confirmation_id = $2
       ORDER BY ts.start_ms, ts.segment_index`,
      [this.tenantId, row.transcript_confirmation_id, row.role_job_id, row.emotion_job_id],
    );
    const knowledgeBaseIds = safeArray(row.knowledge_base_ids);
    const knowledgeBases =
      knowledgeBaseIds.length === 0
        ? { rows: [] }
        : await this.pool.query(
            `SELECT id, name FROM ${this.table('knowledge_bases')}
             WHERE tenant_id = $1 AND id = ANY($2::uuid[])
             ORDER BY id`,
            [this.tenantId, knowledgeBaseIds],
          );
    const settings = row.settings_snapshot as BusinessAnalysisSettingsSnapshot;
    return {
      id: row.id,
      audioFileId: row.audio_file_id,
      groupId: row.group_id,
      revisionId: row.analysis_revision_id,
      confirmationId: row.transcript_confirmation_id,
      confirmationVersion: Number(row.confirmation_version),
      model: row.model,
      workflowVersion: String(row.workflow_version),
      recoveryAttempts: Number(row.recovery_attempts),
      knowledgeBaseIds,
      knowledgeBases: knowledgeBases.rows.map((item) => ({
        id: String(item.id),
        name: String(item.name),
      })),
      settings,
      segments: segments.rows.map((segment) => ({
        id: segment.id,
        speakerKey: String(segment.speaker_key),
        speakerLabel: String(segment.speaker_label),
        startMs: Number(segment.start_ms),
        endMs: Number(segment.end_ms),
        text: String(segment.text),
        role: segment.role_label
          ? { label: String(segment.role_label), confidence: Number(segment.role_confidence) }
          : null,
        emotion: segment.emotion_label
          ? {
              label: String(segment.emotion_label),
              confidence: Number(segment.emotion_confidence),
              attitude: String(segment.attitude),
            }
          : null,
      })),
    };
  }

  async updateProgress(jobId: string, progress: number): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_business_analysis_jobs')}
       SET progress = greatest(progress, $3)
       WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
      [this.tenantId, jobId, Math.max(1, Math.min(99, Math.round(progress)))],
    );
  }

  /** 为同一 checkpoint 工作流安排下一次持久化恢复。 */
  async scheduleRecovery(
    jobId: string,
    code: string,
    message: string,
    delayMs: number,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.table('audio_business_analysis_jobs')}
       SET status = 'queued', recovery_attempts = recovery_attempts + 1,
           next_attempt_at = now() + ($3::double precision * interval '1 millisecond'),
           completed_at = NULL, error_code = $4, error_message = $5, error_retryable = true
       WHERE tenant_id = $1 AND id = $2 AND status = 'running'
         AND recovery_attempts < $6`,
      [
        this.tenantId,
        jobId,
        Math.max(0, delayMs),
        code,
        message.slice(0, 500),
        BUSINESS_ANALYSIS_MAX_RECOVERY_ATTEMPTS,
      ],
    );
    return result.rowCount === 1;
  }

  /** 原子发布经校验的总结、标签、片段证据和检索引用。 */
  async publish(
    job: ClaimedBusinessAnalysisJob,
    result: BusinessAnalysisPublication,
    retrieved: ReadonlyMap<string, RetrievalChunk>,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT job.status, head.active_job_id
         FROM ${this.table('audio_business_analysis_jobs')} job
         LEFT JOIN ${this.table('audio_group_business_analysis_heads')} head
           ON head.tenant_id = job.tenant_id AND head.group_id = job.group_id
          AND head.audio_file_id = job.audio_file_id
         WHERE job.tenant_id = $1 AND job.id = $2
         FOR UPDATE OF job`,
        [this.tenantId, job.id],
      );
      const currentJob = current.rows[0];
      if (!currentJob) {
        throw new WorkspaceRepositoryError('NOT_FOUND', '业务分析任务不存在。');
      }
      if (currentJob.status === 'ready' && currentJob.active_job_id === job.id) {
        await client.query('COMMIT');
        return;
      }
      if (currentJob.status !== 'running') {
        throw new WorkspaceRepositoryError('CONFLICT', '业务分析任务状态已变化，无法发布结果。');
      }
      for (const [index, section] of result.summarySections.entries()) {
        await client.query(
          `INSERT INTO ${this.table('business_analysis_summary_sections')}
             (tenant_id, job_id, section_index, title, body)
           VALUES ($1, $2, $3, $4, $5)`,
          [this.tenantId, job.id, index + 1, section.title, section.body],
        );
      }
      for (const [index, tag] of result.tags.entries()) {
        const created = await client.query(
          `INSERT INTO ${this.table('business_analysis_tags')}
             (tenant_id, job_id, tag_index, category, custom_label, title, summary, details, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
           RETURNING id`,
          [
            this.tenantId,
            job.id,
            index + 1,
            tag.category,
            tag.customLabel,
            tag.title,
            tag.summary,
            JSON.stringify(tag.details),
            tag.confidence,
          ],
        );
        const tagId = created.rows[0].id;
        for (const segmentId of tag.evidenceSegmentIds) {
          await client.query(
            `INSERT INTO ${this.table('business_analysis_tag_segments')}
               (tenant_id, job_id, tag_id, analysis_revision_id, transcript_segment_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [this.tenantId, job.id, tagId, job.revisionId, segmentId],
          );
        }
        for (const chunkId of tag.citedChunkIds) {
          const chunk = retrieved.get(chunkId);
          if (!chunk) continue;
          await client.query(
            `INSERT INTO ${this.table('business_analysis_citations')}
               (tenant_id, job_id, tag_id, chunk_id, knowledge_base_id, document_id,
                document_title, locator)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
            [
              this.tenantId,
              job.id,
              tagId,
              chunk.id,
              chunk.knowledgeBaseId,
              chunk.documentId,
              chunk.documentTitle,
              JSON.stringify(chunk.locator),
            ],
          );
        }
      }
      const published = await client.query(
        `UPDATE ${this.table('audio_business_analysis_jobs')}
         SET status = 'ready', progress = 100, completed_at = now(), published_at = now(),
             limitations = $3::jsonb,
             error_code = NULL, error_message = NULL, error_retryable = NULL
         WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
        [this.tenantId, job.id, JSON.stringify(result.limitations)],
      );
      if (published.rowCount !== 1) {
        throw new WorkspaceRepositoryError('CONFLICT', '业务分析任务状态已变化，无法发布结果。');
      }
      await client.query(
        `INSERT INTO ${this.table('audio_group_business_analysis_heads')}
           (tenant_id, group_id, audio_file_id, active_job_id, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (tenant_id, group_id, audio_file_id) DO UPDATE
         SET active_job_id = excluded.active_job_id, updated_at = now()`,
        [this.tenantId, job.groupId, job.audioFileId, job.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(jobId: string, code: string, message: string, retryable: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_business_analysis_jobs')}
       SET status = 'failed', completed_at = now(), error_code = $3,
           error_message = $4, error_retryable = $5, next_attempt_at = NULL,
           checkpoint_cleanup_pending = true
       WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
      [this.tenantId, jobId, code, message.slice(0, 500), retryable],
    );
  }

  /** 列出已进入终态但仍需清理 LangGraph thread 的任务。 */
  async listCheckpointCleanupCandidates(
    limit = 100,
  ): Promise<{ id: string; workflowVersion: string }[]> {
    const result = await this.pool.query(
      `SELECT id, workflow_version
       FROM ${this.table('audio_business_analysis_jobs')}
       WHERE tenant_id = $1 AND status IN ('ready', 'failed')
         AND checkpoint_cleanup_pending = true
       ORDER BY completed_at NULLS LAST, created_at
       LIMIT $2`,
      [this.tenantId, Math.max(1, Math.min(500, Math.round(limit)))],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      workflowVersion: String(row.workflow_version),
    }));
  }

  /** 仅在 thread 删除成功后清除补偿标记。 */
  async markCheckpointCleaned(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_business_analysis_jobs')}
       SET checkpoint_cleanup_pending = false
       WHERE tenant_id = $1 AND id = $2 AND status IN ('ready', 'failed')`,
      [this.tenantId, jobId],
    );
  }

  /** 恢复最新任务状态和上一份成功发布结果，并标记设置或知识库快照是否过期。 */
  async getState(audioFileId: string, groupId: string) {
    const current = await this.sourceSnapshot(audioFileId, groupId);
    const latest = await this.pool.query(
      `SELECT id, model, status, progress, transcript_confirmation_id, confirmation_version,
              input_fingerprint,
              error_code, error_message, error_retryable
       FROM ${this.table('audio_business_analysis_jobs')}
       WHERE tenant_id = $1 AND group_id = $2 AND audio_file_id = $3
       ORDER BY created_at DESC LIMIT 1`,
      [this.tenantId, groupId, audioFileId],
    );
    const head = await this.pool.query(
      `SELECT job.id, job.model, job.published_at, job.input_fingerprint,
              job.confirmation_version, job.knowledge_base_ids,
              job.settings_snapshot, job.limitations
       FROM ${this.table('audio_group_business_analysis_heads')} head
       JOIN ${this.table('audio_business_analysis_jobs')} job
         ON job.tenant_id = head.tenant_id AND job.id = head.active_job_id
       WHERE head.tenant_id = $1 AND head.group_id = $2 AND head.audio_file_id = $3`,
      [this.tenantId, groupId, audioFileId],
    );
    const published = head.rows[0];
    let result = null;
    if (published) {
      const [sections, tags] = await Promise.all([
        this.pool.query(
          `SELECT id, section_index, title, body
           FROM ${this.table('business_analysis_summary_sections')}
           WHERE tenant_id = $1 AND job_id = $2 ORDER BY section_index`,
          [this.tenantId, published.id],
        ),
        this.pool.query(
          `SELECT tag.id, tag.category, tag.custom_label, tag.title, tag.summary,
                  tag.details, tag.confidence,
                  coalesce(array_agg(DISTINCT map.transcript_segment_id)
                    FILTER (WHERE map.transcript_segment_id IS NOT NULL), '{}') AS segment_ids
           FROM ${this.table('business_analysis_tags')} tag
           LEFT JOIN ${this.table('business_analysis_tag_segments')} map
             ON map.tenant_id = tag.tenant_id AND map.job_id = tag.job_id AND map.tag_id = tag.id
           WHERE tag.tenant_id = $1 AND tag.job_id = $2
           GROUP BY tag.id ORDER BY tag.tag_index`,
          [this.tenantId, published.id],
        ),
      ]);
      const citations = await this.pool.query(
        `SELECT tag_id, chunk_id, knowledge_base_id, document_id, document_title, locator
         FROM ${this.table('business_analysis_citations')}
         WHERE tenant_id = $1 AND job_id = $2`,
        [this.tenantId, published.id],
      );
      const limitations = safeArray(published.limitations);
      result = {
        jobId: published.id,
        groupId,
        confirmationVersion: Number(published.confirmation_version),
        model: published.model,
        generatedAt: iso(published.published_at),
        knowledgeBaseIds: safeArray(published.knowledge_base_ids),
        knowledgeStatus:
          safeArray(published.knowledge_base_ids).length === 0
            ? 'not_linked'
            : citations.rows.length > 0
              ? 'used'
              : 'linked_not_used',
        limitations,
        summarySections: sections.rows.map((section) => ({
          id: section.id,
          index: Number(section.section_index),
          title: section.title,
          body: section.body,
        })),
        tags: tags.rows.map((tag) => ({
          id: tag.id,
          category: tag.category,
          customLabel: tag.custom_label ?? null,
          title: tag.title,
          summary: tag.summary,
          details: safeArray(tag.details),
          confidence: Number(tag.confidence),
          evidenceSegmentIds: safeArray(tag.segment_ids),
          citations: citations.rows
            .filter((citation) => citation.tag_id === tag.id)
            .map((citation) => ({
              chunkId: citation.chunk_id,
              knowledgeBaseId: citation.knowledge_base_id,
              documentId: citation.document_id,
              documentTitle: citation.document_title,
              locator: citation.locator,
            })),
        })),
      };
    }
    const job = latest.rows[0];
    const state = job?.status ?? (result ? 'ready' : 'idle');
    return AudioBusinessAnalysisStateSchema.parse({
      state,
      groupId,
      jobId: job?.id ?? result?.jobId ?? null,
      model: job?.model ?? result?.model ?? null,
      progress: job ? Number(job.progress) : result ? 100 : 0,
      confirmationVersion: job
        ? Number(job.confirmation_version)
        : (result?.confirmationVersion ?? current.confirmationVersion),
      settingsCurrent:
        !published ||
        JSON.stringify(comparableSettings(published.settings_snapshot)) ===
          JSON.stringify(comparableSettings(current.settings)),
      knowledgeCurrent:
        !result ||
        JSON.stringify([...result.knowledgeBaseIds].sort()) ===
          JSON.stringify([...current.knowledgeBaseIds].sort()),
      error:
        job?.status === 'failed'
          ? {
              code: String(job.error_code ?? 'ANALYSIS_FAILED'),
              message: String(job.error_message ?? '业务分析失败。'),
              retryable: Boolean(job.error_retryable),
            }
          : null,
      result,
    });
  }
}
