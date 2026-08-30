/**
 * 知识文档入库持久层。
 *
 * 集中创建入库任务、领取租约、推进阶段并原子发布文档 revision 的 PostgreSQL 事务。
 *
 * Responsibilities:
 * - 管理入库任务与文档处理状态。
 * - 通过 `SKIP LOCKED` 支持 worker 安全领取。
 * - 原子发布文档块、revision 和 active 指针。
 *
 * Notes:
 * - PostgreSQL 专用能力保留为显式 SQL。
 */
import { toSql } from 'pgvector';

import type { DocumentFormat } from '@echowave/contracts';

import type { DatabasePool } from '../../infrastructure/postgres.ts';
import { quoteIdentifier } from '../../infrastructure/postgres.ts';
import type { LiveUpdateBroker } from '../../infrastructure/liveUpdateBroker.ts';
import type { ParsedChunkDraft } from '../ingestion/documentParser.ts';
import { RagRepositoryError } from './errors.ts';

/** worker 已持有租约、可以安全执行的入库任务快照。 */
export type ClaimedIngestionJob = {
  id: string;
  tenantId: string;
  knowledgeBaseId: string;
  documentId: string;
  revisionId: string;
  stagedPath: string;
  title: string;
  format: DocumentFormat;
  sizeBytes: number;
  attempts: number;
};

type PublishInput = {
  job: ClaimedIngestionJob;
  chunks: ParsedChunkDraft[];
  vectors: number[][];
  previewText: string;
  warnings: string[];
  provider: string;
  embeddingTokens: number;
  estimatedCost: { amount: number; currency: 'CNY' | 'USD' };
  embeddingModel: string;
};

/** 隐藏入库任务与 revision 发布事务的 PostgreSQL 仓储。 */
export class IngestionRepository {
  private readonly schema: string;

  constructor(
    private readonly pool: DatabasePool,
    schema: string,
    private readonly tenantId: string,
    private readonly liveUpdates?: LiveUpdateBroker,
  ) {
    this.schema = quoteIdentifier(schema);
  }

  private table(name: string): string {
    return `${this.schema}.${quoteIdentifier(name)}`;
  }

  private notify(knowledgeBaseId: string, documentId: string, terminal: boolean): void {
    this.liveUpdates?.publish({
      kind: 'knowledge-document',
      knowledgeBaseId,
      documentId,
      terminal,
    });
  }

  /** 在单个事务中创建文档、处理中 revision 与待领取任务。 */
  async createIngestion(input: {
    knowledgeBaseId: string;
    title: string;
    format: DocumentFormat;
    sizeBytes: number;
    sourceSha256: string;
    stagedPath: string;
    parserVersion: string;
    embeddingModel: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const knowledgeBase = await client.query(
        `SELECT 1 FROM ${this.table('knowledge_bases')}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [this.tenantId, input.knowledgeBaseId],
      );
      if (!knowledgeBase.rowCount) throw new RagRepositoryError('NOT_FOUND', '知识库不存在。');
      const duplicate = await client.query(
        `SELECT d.id, d.error_code FROM ${this.table('document_revisions')} r
         JOIN ${this.table('documents')} d ON d.tenant_id = r.tenant_id AND d.id = r.document_id
         WHERE r.tenant_id = $1 AND d.knowledge_base_id = $2 AND r.source_sha256 = $3
           AND d.deleted_at IS NULL
         ORDER BY d.updated_at DESC LIMIT 1 FOR UPDATE OF d`,
        [this.tenantId, input.knowledgeBaseId, input.sourceSha256],
      );
      const staleDocument = duplicate.rows[0];
      if (staleDocument && staleDocument.error_code !== 'EMBEDDING_MODEL_MIGRATION_REQUIRED') {
        throw new RagRepositoryError('DUPLICATE_DOCUMENT', '该文件已上传到此知识库。');
      }
      let documentId: string;
      if (staleDocument) {
        documentId = staleDocument.id as string;
        await client.query(
          `UPDATE ${this.table('documents')}
           SET title = $3, format = $4, size_bytes = $5, status = 'queued', progress = 0,
               error_code = NULL, error_message = NULL, error_retryable = NULL, updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [this.tenantId, documentId, input.title, input.format, input.sizeBytes],
        );
      } else {
        const document = await client.query(
          `INSERT INTO ${this.table('documents')}
             (tenant_id, knowledge_base_id, title, format, size_bytes, status)
           VALUES ($1, $2, $3, $4, $5, 'queued') RETURNING id`,
          [this.tenantId, input.knowledgeBaseId, input.title, input.format, input.sizeBytes],
        );
        documentId = document.rows[0].id as string;
      }
      const revision = await client.query(
        `INSERT INTO ${this.table('document_revisions')}
           (tenant_id, document_id, source_sha256, parser_version, embedding_model, embedding_dimensions, status)
         VALUES ($1, $2, $3, $4, $5, 1024, 'processing') RETURNING id`,
        [this.tenantId, documentId, input.sourceSha256, input.parserVersion, input.embeddingModel],
      );
      const revisionId = revision.rows[0].id as string;
      const job = await client.query(
        `INSERT INTO ${this.table('ingestion_jobs')}
           (tenant_id, knowledge_base_id, document_id, revision_id, staged_path, status)
         VALUES ($1, $2, $3, $4, $5, 'queued') RETURNING id`,
        [this.tenantId, input.knowledgeBaseId, documentId, revisionId, input.stagedPath],
      );
      await client.query('COMMIT');
      this.notify(input.knowledgeBaseId, documentId, false);
      return { documentId, jobId: job.rows[0].id as string };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 通过 `SKIP LOCKED` 领取最早可执行或租约已过期的任务。 */
  async claimIngestionJob(): Promise<ClaimedIngestionJob | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM ${this.table('ingestion_jobs')}
         WHERE tenant_id = $1 AND (status = 'queued' OR (status = 'running' AND lease_until < now()))
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE ${this.table('ingestion_jobs')} j
       SET status = 'running', attempts = attempts + 1,
           lease_until = now() + interval '2 minutes', updated_at = now()
       FROM candidate, ${this.table('documents')} d
       WHERE j.id = candidate.id AND d.tenant_id = j.tenant_id AND d.id = j.document_id
       RETURNING j.*, d.title, d.format, d.size_bytes`,
      [this.tenantId],
    );
    const row = result.rows[0];
    if (!row || !row.staged_path) return undefined;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      knowledgeBaseId: row.knowledge_base_id,
      documentId: row.document_id,
      revisionId: row.revision_id,
      stagedPath: row.staged_path,
      title: row.title,
      format: row.format,
      sizeBytes: Number(row.size_bytes),
      attempts: row.attempts,
    };
  }

  /** 推进入库阶段并续租，同时同步文档对外可见状态。 */
  async setJobStage(
    job: ClaimedIngestionJob,
    stage: string,
    status: string,
    progress = 0,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('ingestion_jobs')} SET stage = $3, lease_until = now() + interval '2 minutes', updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, job.id, stage],
    );
    await this.pool.query(
      `UPDATE ${this.table('documents')} SET status = $3, progress = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, job.documentId, status, progress],
    );
    this.notify(job.knowledgeBaseId, job.documentId, false);
  }

  /** 原子写入全部文档块并发布 revision，提交前旧 active revision 始终可检索。 */
  async publishRevision(input: PublishInput): Promise<void> {
    if (input.chunks.length !== input.vectors.length)
      throw new Error('Chunk/vector count mismatch.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM ${this.table('document_chunks')} WHERE tenant_id = $1 AND revision_id = $2`,
        [this.tenantId, input.job.revisionId],
      );
      for (let index = 0; index < input.chunks.length; index += 1) {
        const chunk = input.chunks[index];
        const vector = input.vectors[index];
        if (!chunk || !vector) throw new Error('Chunk/vector count mismatch.');
        await client.query(
          `INSERT INTO ${this.table('document_chunks')}
             (tenant_id, knowledge_base_id, document_id, revision_id, chunk_index, title,
              heading_path, content, embedding_text, content_sha256, locator, embedding_model, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb, $12, $13::vector)`,
          [
            this.tenantId,
            input.job.knowledgeBaseId,
            input.job.documentId,
            input.job.revisionId,
            chunk.index,
            chunk.title,
            JSON.stringify(chunk.headingPath),
            chunk.content,
            chunk.embeddingText,
            chunk.contentSha256,
            JSON.stringify(chunk.locator),
            input.embeddingModel,
            toSql(vector),
          ],
        );
      }
      await client.query(
        `UPDATE ${this.table('document_revisions')}
         SET status = 'ready', preview_text = $3, warnings = $4::jsonb, published_at = now(),
             embedding_provider = $5, embedding_tokens = $6, embedding_cost_amount = $7,
             embedding_cost_currency = $8
         WHERE tenant_id = $1 AND id = $2`,
        [
          this.tenantId,
          input.job.revisionId,
          input.previewText,
          JSON.stringify(input.warnings),
          input.provider,
          input.embeddingTokens,
          input.estimatedCost.amount,
          input.estimatedCost.currency,
        ],
      );
      await client.query(
        `UPDATE ${this.table('documents')}
         SET active_revision_id = $3, status = 'ready', progress = 100, error_code = NULL,
             error_message = NULL, error_retryable = NULL, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, input.job.documentId, input.job.revisionId],
      );
      await client.query(
        `UPDATE ${this.table('ingestion_jobs')}
         SET status = 'completed', stage = 'cleanup', lease_until = NULL, staged_path = NULL, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, input.job.id],
      );
      await client.query('COMMIT');
      this.notify(input.job.knowledgeBaseId, input.job.documentId, true);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 将任务、文档和 revision 同步标记为失败。 */
  async failJob(
    job: ClaimedIngestionJob,
    code: string,
    message: string,
    retryable: boolean,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('ingestion_jobs')}
       SET status = 'failed', lease_until = NULL, error_code = $3, error_message = $4,
           error_retryable = $5, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, job.id, code, message, retryable],
    );
    await this.pool.query(
      `UPDATE ${this.table('documents')}
       SET status = 'failed', error_code = $3, error_message = $4, error_retryable = $5, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, job.documentId, code, message, retryable],
    );
    await this.pool.query(
      `UPDATE ${this.table('document_revisions')} SET status = 'failed'
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, job.revisionId],
    );
    this.notify(job.knowledgeBaseId, job.documentId, true);
  }

  /** 仅重新排队仍保留暂存文件且标记为可重试的失败任务。 */
  async retryDocument(knowledgeBaseId: string, documentId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.table('ingestion_jobs')} j
       SET status = 'queued', error_code = NULL, error_message = NULL, error_retryable = NULL, updated_at = now()
       FROM ${this.table('documents')} d
       WHERE j.tenant_id = $1 AND j.knowledge_base_id = $2 AND j.document_id = $3
         AND d.tenant_id = j.tenant_id AND d.id = j.document_id AND d.status = 'failed'
         AND j.error_retryable = true AND j.staged_path IS NOT NULL RETURNING j.id`,
      [this.tenantId, knowledgeBaseId, documentId],
    );
    if (!result.rowCount)
      throw new RagRepositoryError('CONFLICT', '该失败不能直接重试，请重新上传文件。');
    await this.pool.query(
      `UPDATE ${this.table('documents')}
       SET status = 'queued', progress = 0, error_code = NULL, error_message = NULL, error_retryable = NULL
       WHERE tenant_id = $1 AND knowledge_base_id = $2 AND id = $3`,
      [this.tenantId, knowledgeBaseId, documentId],
    );
    this.notify(knowledgeBaseId, documentId, false);
  }
}
