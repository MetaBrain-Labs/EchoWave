/**
 * 说话人疑点复核任务仓储。
 *
 * 以 PostgreSQL 保存独立复核任务，并将模型结果限制为已有原始片段的合法词边界。
 *
 * Responsibilities:
 * - 领取、恢复、发布和失败收敛说话人复核任务。
 * - 原子合并规则与模型发现。
 */
import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';

export type SpeakerReviewSegment = {
  id: string;
  speakerKey: string;
  words: { index: number; startMs: number; endMs: number; text: string; punctuation: string }[];
  candidateBoundaries: number[];
};

export type ClaimedSpeakerReviewJob = {
  id: string;
  audioFileId: string;
  revisionId: string;
  capabilityBindingRevisionId: string | null;
  model: string;
  segments: SpeakerReviewSegment[];
};

export type ModelSpeakerReviewFinding = {
  segmentId: string;
  splitAfterWordIndex: number;
  severity: 'medium' | 'high';
  reasonCode: 'question_answer_transition' | 'long_internal_pause' | 'dialogue_pattern';
  explanation: string;
};

/** 持久化异步说话人复核生命周期。 */
export class SpeakerReviewRepository {
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

  /** 把进程中断的任务恢复为可领取状态。 */
  async resetInterrupted(): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_speaker_review_jobs')}
       SET status = 'queued', error_code = NULL, error_message = NULL
       WHERE tenant_id = $1 AND status = 'running'`,
      [this.tenantId],
    );
  }

  /** 领取最早任务并加载不可变原始词级转写。 */
  async claim(): Promise<ClaimedSpeakerReviewJob | undefined> {
    const claimed = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM ${this.table('audio_speaker_review_jobs')}
         WHERE tenant_id = $1 AND status = 'queued'
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE ${this.table('audio_speaker_review_jobs')} job
       SET status = 'running'
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING job.id, job.audio_file_id, job.analysis_revision_id,
                 job.capability_binding_revision_id, job.model`,
      [this.tenantId],
    );
    const row = claimed.rows[0];
    if (!row?.model) return undefined;
    const segments = await this.pool.query(
      `SELECT id, speaker_key, words
       FROM ${this.table('transcript_segments')}
       WHERE tenant_id = $1 AND analysis_revision_id = $2
       ORDER BY segment_index`,
      [this.tenantId, row.analysis_revision_id],
    );
    const candidates = await this.pool.query(
      `SELECT source_transcript_segment_id, split_after_word_index
       FROM ${this.table('speaker_review_findings')}
       WHERE tenant_id = $1 AND analysis_revision_id = $2
         AND source_transcript_segment_id IS NOT NULL
         AND split_after_word_index IS NOT NULL`,
      [this.tenantId, row.analysis_revision_id],
    );
    return {
      id: row.id,
      audioFileId: row.audio_file_id,
      revisionId: row.analysis_revision_id,
      capabilityBindingRevisionId: row.capability_binding_revision_id ?? null,
      model: row.model,
      segments: segments.rows.map((segment) => ({
        id: String(segment.id),
        speakerKey: String(segment.speaker_key),
        words: Array.isArray(segment.words) ? segment.words : [],
        candidateBoundaries: candidates.rows
          .filter(
            (candidate) => String(candidate.source_transcript_segment_id) === String(segment.id),
          )
          .map((candidate) => Number(candidate.split_after_word_index)),
      })),
    };
  }

  /** 合并模型发现并完成任务；同边界模型结果覆盖规则说明但不改变正文或 Speaker。 */
  async publish(
    job: ClaimedSpeakerReviewJob,
    findings: ModelSpeakerReviewFinding[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const finding of findings) {
        await client.query(
          `INSERT INTO ${this.table('speaker_review_findings')}
             (tenant_id, analysis_revision_id, source_transcript_segment_id,
              split_after_word_index, kind, severity, reason_code, explanation, finding_source)
           VALUES ($1, $2, $3, $4, 'speaker_turn_suspected', $5, $6, $7, 'model')
           ON CONFLICT (tenant_id, analysis_revision_id, source_transcript_segment_id,
                        split_after_word_index)
             WHERE source_transcript_segment_id IS NOT NULL
           DO UPDATE SET severity = EXCLUDED.severity, reason_code = EXCLUDED.reason_code,
                         explanation = EXCLUDED.explanation, finding_source = 'model'`,
          [
            this.tenantId,
            job.revisionId,
            finding.segmentId,
            finding.splitAfterWordIndex,
            finding.severity,
            finding.reasonCode,
            finding.explanation,
          ],
        );
      }
      if (findings.length > 0) {
        await client.query(
          `UPDATE ${this.table('audio_analysis_revisions')}
           SET speaker_review_resolved_at = NULL
           WHERE tenant_id = $1 AND id = $2`,
          [this.tenantId, job.revisionId],
        );
      }
      await client.query(
        `UPDATE ${this.table('audio_speaker_review_jobs')}
         SET status = 'ready', completed_at = now(), error_code = NULL, error_message = NULL
         WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
        [this.tenantId, job.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 将辅助模型失败收敛为 partial 展示，不影响已发布转写。 */
  async fail(jobId: string, code: string, message: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_speaker_review_jobs')}
       SET status = 'failed', completed_at = now(), error_code = $3, error_message = $4
       WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
      [this.tenantId, jobId, code.slice(0, 100), message.slice(0, 500)],
    );
  }
}
