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

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import { WorkspaceRepositoryError } from './errors.ts';

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

  /** 校验乐观版本并原子发布下一版完整确认正文。 */
  async confirm(audioFileId: string, input: AudioTranscriptConfirmationRequest) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const active = await client.query(
        `SELECT ar.id AS revision_id, tc.version_no AS current_version
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
        `SELECT id FROM ${this.table('transcript_segments')}
         WHERE tenant_id = $1 AND analysis_revision_id = $2
         ORDER BY segment_index`,
        [this.tenantId, input.analysisRevisionId],
      );
      const rawIds = new Set(rawSegments.rows.map((segment) => String(segment.id)));
      const inputIds = new Set(input.segments.map((segment) => segment.segmentId));
      if (
        rawIds.size !== input.segments.length ||
        inputIds.size !== input.segments.length ||
        input.segments.some((segment) => !rawIds.has(segment.segmentId))
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
      for (const segment of input.segments) {
        await client.query(
          `INSERT INTO ${this.table('transcript_confirmation_segments')}
             (tenant_id, transcript_confirmation_id, analysis_revision_id,
              transcript_segment_id, text)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            this.tenantId,
            confirmationId,
            input.analysisRevisionId,
            segment.segmentId,
            segment.text.trim(),
          ],
        );
      }
      await client.query(
        `UPDATE ${this.table('audio_analysis_revisions')}
         SET active_transcript_confirmation_id = $3
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, input.analysisRevisionId, confirmationId],
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
