/**
 * 转写人工确认仓储。
 *
 * 将不可变的供应商 Raw Transcript 与用户确认快照分离，并通过乐观版本和事务锁
 * 保证一次确认完整覆盖当前 ASR 修订的全部片段。
 *
 * Responsibilities:
 * - 校验当前音频、ASR 修订、基础确认版本和片段集合。
 * - 原子创建完整 Confirmed Transcript 并切换当前指针。
 *
 * Notes:
 * - 本仓储绝不更新 `transcript_segments.text`，该字段永久保存 Raw Transcript。
 */
import {
  AudioTranscriptConfirmationResponseSchema,
  type AudioTranscriptConfirmationRequest,
} from '@echowave/contracts';
import { randomUUID } from 'node:crypto';

import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';
import { WorkspaceRepositoryError } from '../../errors.ts';

/** 发布不可变 Confirmed Transcript 快照。 */
export class TranscriptConfirmationRepository {
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

  /** 为自动流水线幂等创建 Raw Transcript 的系统快照，已有确认时保持原确认不变。 */
  async ensureSystemRawSnapshot(audioFileId: string, revisionId: string): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const active = await client.query(
        `SELECT ar.active_transcript_confirmation_id
         FROM ${this.table('audio_files')} af
         JOIN ${this.table('audio_analysis_revisions')} ar
           ON ar.tenant_id = af.tenant_id AND ar.id = af.active_analysis_revision_id
         WHERE af.tenant_id = $1 AND af.id = $2 AND af.deleted_at IS NULL
           AND ar.id = $3 AND ar.status = 'ready'
         FOR UPDATE OF ar`,
        [this.tenantId, audioFileId, revisionId],
      );
      const row = active.rows[0];
      if (!row) throw new WorkspaceRepositoryError('CONFLICT', '自动分析需要已发布的当前转写。');
      if (row.active_transcript_confirmation_id) {
        await client.query('COMMIT');
        return String(row.active_transcript_confirmation_id);
      }
      const snapshot = await client.query(
        `INSERT INTO ${this.table('transcript_confirmations')}
           (tenant_id, analysis_revision_id, version_no, origin)
         VALUES ($1, $2, 1, 'system_raw_snapshot') RETURNING id`,
        [this.tenantId, revisionId],
      );
      const confirmationId = String(snapshot.rows[0].id);
      const copied = await client.query(
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
        [this.tenantId, revisionId, confirmationId],
      );
      if (!copied.rowCount)
        throw new WorkspaceRepositoryError('CONFLICT', '转写没有可确认的正文片段。');
      await client.query(
        `UPDATE ${this.table('audio_analysis_revisions')}
         SET active_transcript_confirmation_id = $3
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, revisionId, confirmationId],
      );
      await client.query('COMMIT');
      return confirmationId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 校验乐观版本并原子发布下一版完整确认正文。 */
  async confirm(audioFileId: string, input: AudioTranscriptConfirmationRequest) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const active = await client.query(
        `SELECT ar.id AS revision_id, tc.version_no AS current_version,
                ar.active_emotion_job_id, ar.bundled_emotion_job_id,
                af.runtime_mode
         FROM ${this.table('audio_files')} af
         JOIN ${this.table('audio_analysis_revisions')} ar
           ON ar.tenant_id = af.tenant_id AND ar.id = af.active_analysis_revision_id
         LEFT JOIN ${this.table('transcript_confirmations')} tc
           ON tc.tenant_id = ar.tenant_id AND tc.id = ar.active_transcript_confirmation_id
         WHERE af.tenant_id = $1 AND af.id = $2 AND af.deleted_at IS NULL
           AND ar.status = 'ready'
         FOR UPDATE OF af, ar`,
        [this.tenantId, audioFileId],
      );
      const row = active.rows[0];
      if (!row) {
        throw new WorkspaceRepositoryError('NOT_FOUND', '音频不存在或尚无可确认的转写。');
      }
      if (row.revision_id !== input.analysisRevisionId) {
        throw new WorkspaceRepositoryError('CONFLICT', '当前转写修订已变化，请重新加载后再编辑。');
      }
      const currentVersion = row.current_version === null ? 0 : Number(row.current_version);
      if (currentVersion !== input.baseVersion) {
        throw new WorkspaceRepositoryError('CONFLICT', '确认版本已变化，请重新加载后再编辑。');
      }

      const rawSegments = await client.query(
        `SELECT id, speaker_key, start_ms, end_ms, words
         FROM ${this.table('transcript_segments')}
         WHERE tenant_id = $1 AND analysis_revision_id = $2
         ORDER BY segment_index`,
        [this.tenantId, input.analysisRevisionId],
      );
      const rawIds = new Set(rawSegments.rows.map((segment) => String(segment.id)));
      const inputIds = new Set(input.segments.map((segment) => segment.sourceSegmentId));
      if (
        rawIds.size !== input.segments.length ||
        inputIds.size !== input.segments.length ||
        input.segments.some((segment) => !rawIds.has(segment.sourceSegmentId))
      ) {
        throw new WorkspaceRepositoryError(
          'CONFLICT',
          '确认内容必须完整对应当前转写片段，请重新加载后再编辑。',
        );
      }

      const created = await client.query(
        `INSERT INTO ${this.table('transcript_confirmations')}
           (tenant_id, analysis_revision_id, version_no)
         VALUES ($1, $2, $3)
         RETURNING id, confirmed_at`,
        [this.tenantId, input.analysisRevisionId, currentVersion + 1],
      );
      const confirmationId = String(created.rows[0].id);
      const inputBySource = new Map(
        input.segments.map((segment) => [segment.sourceSegmentId, segment]),
      );
      let confirmedIndex = 0;
      for (const raw of rawSegments.rows) {
        const sourceSegmentId = String(raw.id);
        const segment = inputBySource.get(sourceSegmentId)!;
        const words = Array.isArray(raw.words)
          ? (raw.words as { startMs: number; endMs: number }[])
          : [];
        const wordCount = Math.max(words.length, 1);
        let cursor = 0;
        for (const part of segment.parts) {
          if (
            part.startWordIndex !== cursor ||
            part.endWordIndex > wordCount ||
            part.endWordIndex <= part.startWordIndex
          ) {
            throw new WorkspaceRepositoryError(
              'CONFLICT',
              '确认片段必须按原始词边界连续、无重叠地覆盖整段内容。',
            );
          }
          cursor = part.endWordIndex;
        }
        if (cursor !== wordCount || (words.length === 0 && segment.parts.length !== 1)) {
          throw new WorkspaceRepositoryError(
            'CONFLICT',
            words.length === 0
              ? '历史转写缺少词级时间戳，不能拆分 Speaker；请重新转写。'
              : '确认片段必须完整覆盖原始词边界。',
          );
        }
        for (const part of segment.parts) {
          confirmedIndex += 1;
          const wholeSource =
            segment.parts.length === 1 &&
            part.startWordIndex === 0 &&
            part.endWordIndex === wordCount;
          const startMs =
            words.length === 0 ? Number(raw.start_ms) : words[part.startWordIndex]!.startMs;
          const endMs =
            words.length === 0 ? Number(raw.end_ms) : words[part.endWordIndex - 1]!.endMs;
          await client.query(
            `INSERT INTO ${this.table('transcript_confirmation_segments')}
               (tenant_id, transcript_confirmation_id, analysis_revision_id,
                source_transcript_segment_id, confirmed_segment_id, part_index,
                speaker_key, start_word_index, end_word_index, start_ms, end_ms, text)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              this.tenantId,
              confirmationId,
              input.analysisRevisionId,
              sourceSegmentId,
              wholeSource ? sourceSegmentId : randomUUID(),
              confirmedIndex,
              part.speakerKey,
              part.startWordIndex,
              part.endWordIndex,
              startMs,
              endMs,
              part.text.trim(),
            ],
          );
        }
      }
      const preserveBundledEmotion =
        row.runtime_mode === 'lightweight_local' &&
        row.active_emotion_job_id !== null &&
        row.active_emotion_job_id === row.bundled_emotion_job_id;
      await client.query(
        `UPDATE ${this.table('audio_analysis_revisions')}
         SET active_transcript_confirmation_id = $3,
             active_emotion_job_id = CASE WHEN $4::boolean THEN active_emotion_job_id ELSE NULL END,
             active_role_job_id = NULL
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, input.analysisRevisionId, confirmationId, preserveBundledEmotion],
      );
      const response = AudioTranscriptConfirmationResponseSchema.parse({
        audioFileId,
        analysisRevisionId: input.analysisRevisionId,
        confirmationId,
        version: currentVersion + 1,
        confirmedAt: new Date(created.rows[0].confirmed_at as string | Date).toISOString(),
      });
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new WorkspaceRepositoryError('CONFLICT', '确认版本已变化，请重新加载后再编辑。');
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
