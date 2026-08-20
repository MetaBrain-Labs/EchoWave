/**
 * RAG PostgreSQL 仓储模块。
 *
 * 集中知识库、文档修订版、入库任务、向量检索、问答会话与运行审计的租户范围 SQL，
 * 确保所有读写遵守同一数据权威和事务规则。
 *
 * Responsibilities:
 * - 执行知识库与文档的租户隔离 CRUD。
 * - 领取、推进并原子发布入库 revision。
 * - 执行 pgvector 检索并记录问答运行。
 *
 * Notes:
 * - 复杂 PostgreSQL 能力保留为显式 SQL，不在调用方重复实现。
 */
import { toSql } from 'pgvector';

import {
  DocumentChunkSchema,
  KnowledgeBaseDetailSchema,
  KnowledgeBaseListResponseSchema,
  KnowledgeDocumentDetailSchema,
  KnowledgeDocumentListResponseSchema,
  KnowledgeDocumentSchema,
  SourceLocatorSchema,
  type DocumentFormat,
  type KnowledgeBaseCreateRequest,
  type KnowledgeBaseSummary,
  type KnowledgeDocument,
  type SourceLocator,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../database.ts';
import type { ParsedChunkDraft } from './documentParser.ts';

/** 可由传输层稳定映射的知识库仓储领域错误。 */
export class RagRepositoryError extends Error {
  constructor(
    public readonly code: 'CONFLICT' | 'DUPLICATE_DOCUMENT' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'RagRepositoryError';
  }
}

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

/** 向可信回答模块返回的可引用检索结果。 */
export type RetrievalChunk = {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  locator: SourceLocator;
  distance: number;
};

type PublishInput = {
  job: ClaimedIngestionJob;
  chunks: ParsedChunkDraft[];
  vectors: number[][];
  previewText: string;
  warnings: string[];
  provider: string;
  embeddingTokens: number;
  estimatedCostUsd: number;
  embeddingModel: string;
};

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function documentStatus(row: Record<string, unknown>) {
  const kind = String(row.status);
  if (kind === 'embedding') return { kind, progress: Number(row.progress) } as const;
  if (kind === 'ready') return { kind, parsedAt: iso(row.published_at as Date | string) } as const;
  if (kind === 'failed') {
    return {
      kind,
      code: String(row.error_code ?? 'INTERNAL_ERROR'),
      message: String(row.error_message ?? '文档处理失败。'),
      retryable: Boolean(row.error_retryable),
    } as const;
  }
  if (kind === 'queued' || kind === 'validating' || kind === 'parsing' || kind === 'chunking' || kind === 'deleting') {
    return { kind } as const;
  }
  throw new Error(`Unknown document status: ${kind}`);
}

function mapDocument(row: Record<string, unknown>): KnowledgeDocument {
  return KnowledgeDocumentSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    title: row.title,
    format: row.format,
    sizeBytes: Number(row.size_bytes),
    status: documentStatus(row),
    vectorCount: Number(row.vector_count ?? 0),
    updatedAt: iso(row.updated_at as Date | string),
  });
}

/** 集中所有租户范围 RAG SQL 与事务不变量的 PostgreSQL 仓储。 */
export class RagRepository {
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

  async listKnowledgeBases() {
    const result = await this.pool.query(
      `SELECT kb.id, kb.name, kb.description, kb.updated_at,
              count(d.id)::int AS document_count
       FROM ${this.table('knowledge_bases')} kb
       LEFT JOIN ${this.table('documents')} d
         ON d.tenant_id = kb.tenant_id AND d.knowledge_base_id = kb.id AND d.deleted_at IS NULL
       WHERE kb.tenant_id = $1 AND kb.deleted_at IS NULL
       GROUP BY kb.id
       ORDER BY kb.updated_at DESC`,
      [this.tenantId],
    );
    return KnowledgeBaseListResponseSchema.parse({
      items: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        documentCount: row.document_count,
        linkedGroupCount: 0,
        updatedAt: iso(row.updated_at),
      })),
    });
  }

  async getKnowledgeBase(id: string): Promise<KnowledgeBaseSummary> {
    const result = await this.pool.query(
      `SELECT kb.id, kb.name, kb.description, kb.updated_at,
              count(d.id)::int AS document_count
       FROM ${this.table('knowledge_bases')} kb
       LEFT JOIN ${this.table('documents')} d
         ON d.tenant_id = kb.tenant_id AND d.knowledge_base_id = kb.id AND d.deleted_at IS NULL
       WHERE kb.tenant_id = $1 AND kb.id = $2 AND kb.deleted_at IS NULL
       GROUP BY kb.id`,
      [this.tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw new RagRepositoryError('NOT_FOUND', '知识库不存在。');
    return KnowledgeBaseDetailSchema.parse({
      id: row.id,
      name: row.name,
      description: row.description,
      documentCount: row.document_count,
      linkedGroupCount: 0,
      updatedAt: iso(row.updated_at),
    });
  }

  async createKnowledgeBase(input: KnowledgeBaseCreateRequest) {
    const result = await this.pool.query(
      `INSERT INTO ${this.table('knowledge_bases')} (tenant_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [this.tenantId, input.name, input.description],
    );
    return this.getKnowledgeBase(result.rows[0].id as string);
  }

  async updateKnowledgeBase(id: string, input: Partial<KnowledgeBaseCreateRequest>) {
    const result = await this.pool.query(
      `UPDATE ${this.table('knowledge_bases')}
       SET name = COALESCE($3, name), description = COALESCE($4, description), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [this.tenantId, id, input.name ?? null, input.description ?? null],
    );
    if (!result.rowCount) throw new RagRepositoryError('NOT_FOUND', '知识库不存在。');
    return this.getKnowledgeBase(id);
  }

  async deleteKnowledgeBase(id: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.table('knowledge_bases')} SET deleted_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [this.tenantId, id],
    );
    if (!result.rowCount) throw new RagRepositoryError('NOT_FOUND', '知识库不存在。');
    await this.pool.query(
      `UPDATE ${this.table('documents')}
       SET deleted_at = now(), status = 'deleting', updated_at = now()
       WHERE tenant_id = $1 AND knowledge_base_id = $2 AND deleted_at IS NULL`,
      [this.tenantId, id],
    );
  }

  async listDocuments(knowledgeBaseId: string) {
    await this.getKnowledgeBase(knowledgeBaseId);
    const result = await this.pool.query(
      `SELECT d.*, r.published_at, count(c.id)::int AS vector_count
       FROM ${this.table('documents')} d
       JOIN ${this.table('knowledge_bases')} kb
         ON kb.tenant_id = d.tenant_id AND kb.id = d.knowledge_base_id AND kb.deleted_at IS NULL
       LEFT JOIN ${this.table('document_revisions')} r
         ON r.tenant_id = d.tenant_id AND r.id = d.active_revision_id
       LEFT JOIN ${this.table('document_chunks')} c
         ON c.tenant_id = d.tenant_id AND c.revision_id = d.active_revision_id
       WHERE d.tenant_id = $1 AND d.knowledge_base_id = $2 AND d.deleted_at IS NULL
       GROUP BY d.id, r.published_at
       ORDER BY d.updated_at DESC`,
      [this.tenantId, knowledgeBaseId],
    );
    return KnowledgeDocumentListResponseSchema.parse({ items: result.rows.map(mapDocument) });
  }

  async getDocument(knowledgeBaseId: string, documentId: string) {
    const result = await this.pool.query(
      `SELECT d.*, r.published_at, r.preview_text, count(c.id)::int AS vector_count
       FROM ${this.table('documents')} d
       JOIN ${this.table('knowledge_bases')} kb
         ON kb.tenant_id = d.tenant_id AND kb.id = d.knowledge_base_id AND kb.deleted_at IS NULL
       LEFT JOIN ${this.table('document_revisions')} r
         ON r.tenant_id = d.tenant_id AND r.id = d.active_revision_id
       LEFT JOIN ${this.table('document_chunks')} c
         ON c.tenant_id = d.tenant_id AND c.revision_id = d.active_revision_id
       WHERE d.tenant_id = $1 AND d.knowledge_base_id = $2 AND d.id = $3 AND d.deleted_at IS NULL
       GROUP BY d.id, r.published_at, r.preview_text`,
      [this.tenantId, knowledgeBaseId, documentId],
    );
    const row = result.rows[0];
    if (!row) throw new RagRepositoryError('NOT_FOUND', '文档不存在。');
    const chunks = await this.listChunks(knowledgeBaseId, documentId);
    return KnowledgeDocumentDetailSchema.parse({
      ...mapDocument(row),
      chunks: chunks.items,
      previewText: row.preview_text ?? '',
    });
  }

  async listChunks(knowledgeBaseId: string, documentId: string) {
    const result = await this.pool.query(
      `SELECT c.id, c.chunk_index, c.title, c.content, c.locator
       FROM ${this.table('document_chunks')} c
       JOIN ${this.table('documents')} d
         ON d.tenant_id = c.tenant_id AND d.id = c.document_id AND d.active_revision_id = c.revision_id
       JOIN ${this.table('knowledge_bases')} kb
         ON kb.tenant_id = c.tenant_id AND kb.id = c.knowledge_base_id AND kb.deleted_at IS NULL
       WHERE c.tenant_id = $1 AND c.knowledge_base_id = $2 AND c.document_id = $3
         AND d.deleted_at IS NULL
       ORDER BY c.chunk_index`,
      [this.tenantId, knowledgeBaseId, documentId],
    );
    return {
      items: result.rows.map((row) =>
        DocumentChunkSchema.parse({
          id: row.id,
          index: row.chunk_index,
          title: row.title,
          content: row.content,
          charCount: row.content.length,
          vectorId: row.id,
          locator: SourceLocatorSchema.parse(row.locator),
          sourceExcerpt: row.content.slice(0, 240),
        }),
      ),
    };
  }

  async getChunk(knowledgeBaseId: string, documentId: string, chunkId: string) {
    const chunks = await this.listChunks(knowledgeBaseId, documentId);
    const chunk = chunks.items.find((item) => item.id === chunkId);
    if (!chunk) throw new RagRepositoryError('NOT_FOUND', '文档块不存在。');
    return chunk;
  }

  /** 在单个事务中创建文档、处理中 revision 与待领取任务，避免留下不完整的入库状态。 */
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
    await this.getKnowledgeBase(input.knowledgeBaseId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const duplicate = await client.query(
        `SELECT d.id FROM ${this.table('document_revisions')} r
         JOIN ${this.table('documents')} d ON d.tenant_id = r.tenant_id AND d.id = r.document_id
         WHERE r.tenant_id = $1 AND d.knowledge_base_id = $2 AND r.source_sha256 = $3
           AND d.deleted_at IS NULL LIMIT 1`,
        [this.tenantId, input.knowledgeBaseId, input.sourceSha256],
      );
      if (duplicate.rowCount) {
        throw new RagRepositoryError('DUPLICATE_DOCUMENT', '该文件已上传到此知识库。');
      }
      const document = await client.query(
        `INSERT INTO ${this.table('documents')}
           (tenant_id, knowledge_base_id, title, format, size_bytes, status)
         VALUES ($1, $2, $3, $4, $5, 'queued') RETURNING id`,
        [this.tenantId, input.knowledgeBaseId, input.title, input.format, input.sizeBytes],
      );
      const documentId = document.rows[0].id as string;
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
      return { documentId, jobId: job.rows[0].id as string };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 领取最早可执行或租约已过期的任务。
   * `SKIP LOCKED` 允许多个 worker 并行领取而不会阻塞或重复处理同一任务。
   */
  async claimIngestionJob(): Promise<ClaimedIngestionJob | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM ${this.table('ingestion_jobs')}
         WHERE tenant_id = $1
           AND (status = 'queued' OR (status = 'running' AND lease_until < now()))
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

  async setJobStage(job: ClaimedIngestionJob, stage: string, status: string, progress = 0): Promise<void> {
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
  }

  /**
   * 原子写入全部文档块并发布 revision。
   * 提交前旧 active revision 始终可检索，避免读请求看到半成品向量或中间状态。
   */
  async publishRevision(input: PublishInput): Promise<void> {
    if (input.chunks.length !== input.vectors.length) throw new Error('Chunk/vector count mismatch.');
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
            this.tenantId, input.job.knowledgeBaseId, input.job.documentId, input.job.revisionId,
            chunk.index, chunk.title, JSON.stringify(chunk.headingPath), chunk.content, chunk.embeddingText,
            chunk.contentSha256, JSON.stringify(chunk.locator), input.embeddingModel, toSql(vector),
          ],
        );
      }
      await client.query(
        `UPDATE ${this.table('document_revisions')}
         SET status = 'ready', preview_text = $3, warnings = $4::jsonb, published_at = now(),
             embedding_provider = $5, embedding_tokens = $6, embedding_cost_usd = $7
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, input.job.revisionId, input.previewText, JSON.stringify(input.warnings), input.provider,
          input.embeddingTokens, input.estimatedCostUsd],
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
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async failJob(job: ClaimedIngestionJob, code: string, message: string, retryable: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('ingestion_jobs')}
       SET status = 'failed', lease_until = NULL, error_code = $3, error_message = $4,
           error_retryable = $5, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
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
  }

  async retryDocument(knowledgeBaseId: string, documentId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.table('ingestion_jobs')} j
       SET status = 'queued', error_code = NULL, error_message = NULL, error_retryable = NULL, updated_at = now()
       FROM ${this.table('documents')} d
       WHERE j.tenant_id = $1 AND j.knowledge_base_id = $2 AND j.document_id = $3
         AND d.tenant_id = j.tenant_id AND d.id = j.document_id AND d.status = 'failed'
         AND j.error_retryable = true AND j.staged_path IS NOT NULL
       RETURNING j.id`,
      [this.tenantId, knowledgeBaseId, documentId],
    );
    if (!result.rowCount) throw new RagRepositoryError('CONFLICT', '该失败不能直接重试，请重新上传文件。');
    await this.pool.query(
      `UPDATE ${this.table('documents')}
       SET status = 'queued', progress = 0, error_code = NULL, error_message = NULL, error_retryable = NULL
       WHERE tenant_id = $1 AND knowledge_base_id = $2 AND id = $3`,
      [this.tenantId, knowledgeBaseId, documentId],
    );
  }

  async deleteDocument(knowledgeBaseId: string, documentId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.table('documents')}
       SET deleted_at = now(), status = 'deleting', updated_at = now()
       WHERE tenant_id = $1 AND knowledge_base_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [this.tenantId, knowledgeBaseId, documentId],
    );
    if (!result.rowCount) throw new RagRepositoryError('NOT_FOUND', '文档不存在。');
  }

  /**
   * 仅检索当前租户、指定知识库和 active revision 的向量块。
   * HNSW 参数只在当前事务生效，随后按内容去重并限制单文档、总块数与上下文字符数。
   */
  async search(knowledgeBaseId: string, embedding: number[]): Promise<RetrievalChunk[]> {
    const startedAt = Date.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL hnsw.ef_search = 100');
      await client.query("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
      const result = await client.query(
        `SELECT c.id, c.document_id, d.title AS document_title, c.content, c.content_sha256,
                c.locator, c.embedding <=> $3::vector AS distance
         FROM ${this.table('document_chunks')} c
         JOIN ${this.table('documents')} d
           ON d.tenant_id = c.tenant_id AND d.id = c.document_id AND d.active_revision_id = c.revision_id
         WHERE c.tenant_id = $1 AND c.knowledge_base_id = $2 AND d.deleted_at IS NULL
         ORDER BY c.embedding <=> $3::vector LIMIT 30`,
        [this.tenantId, knowledgeBaseId, toSql(embedding)],
      );
      await client.query('COMMIT');
      const hashes = new Set<string>();
      const perDocument = new Map<string, number>();
      const selected: RetrievalChunk[] = [];
      let characters = 0;
      for (const row of result.rows) {
        if (hashes.has(row.content_sha256)) continue;
        const count = perDocument.get(row.document_id) ?? 0;
        if (count >= 3 || selected.length >= 8 || characters + row.content.length > 12_000) continue;
        hashes.add(row.content_sha256);
        perDocument.set(row.document_id, count + 1);
        characters += row.content.length;
        selected.push({
          id: row.id,
          documentId: row.document_id,
          documentTitle: row.document_title,
          content: row.content,
          locator: SourceLocatorSchema.parse(row.locator),
          distance: Number(row.distance),
        });
      }
      console.info('Knowledge retrieval completed', {
        knowledgeBaseId,
        candidateCount: result.rowCount ?? result.rows.length,
        selectedCount: selected.length,
        durationMs: Date.now() - startedAt,
      });
      return selected;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 复用同租户、同知识库且未过期的会话并续期；否则为有效知识库创建新会话。 */
  async getOrCreateConversation(knowledgeBaseId: string, conversationId?: string) {
    if (conversationId) {
      const existing = await this.pool.query(
        `UPDATE ${this.table('rag_conversations')}
         SET expires_at = now() + interval '30 days', updated_at = now()
         WHERE tenant_id = $1 AND knowledge_base_id = $2 AND id = $3 AND expires_at > now()
         RETURNING id, thread_id`,
        [this.tenantId, knowledgeBaseId, conversationId],
      );
      if (!existing.rowCount) throw new RagRepositoryError('NOT_FOUND', '会话不存在或已过期。');
      return { id: existing.rows[0].id as string, threadId: existing.rows[0].thread_id as string };
    }
    const created = await this.pool.query(
      `INSERT INTO ${this.table('rag_conversations')}
         (tenant_id, knowledge_base_id, thread_id, expires_at)
       SELECT $1, kb.id, gen_random_uuid(), now() + interval '30 days'
       FROM ${this.table('knowledge_bases')} kb
       WHERE kb.tenant_id = $1 AND kb.id = $2 AND kb.deleted_at IS NULL
       RETURNING id, thread_id`,
      [this.tenantId, knowledgeBaseId],
    );
    if (!created.rowCount) throw new RagRepositoryError('NOT_FOUND', '知识库不存在。');
    return { id: created.rows[0].id as string, threadId: created.rows[0].thread_id as string };
  }

  /** 在调用模型前创建 running 审计记录，使失败请求也拥有可追踪的运行标识。 */
  async beginRun(input: {
    knowledgeBaseId: string; conversationId: string; question: string;
    embeddingModel: string; chatModel: string; chatProvider: string;
  }): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO ${this.table('rag_runs')}
         (tenant_id, knowledge_base_id, conversation_id, question, embedding_model, chat_model, chat_provider, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'running') RETURNING id`,
      [this.tenantId, input.knowledgeBaseId, input.conversationId, input.question,
        input.embeddingModel, input.chatModel, input.chatProvider],
    );
    return result.rows[0].id as string;
  }

  /** 在可信性校验完成后一次性写入答案、引用、用量与耗时，并标记运行成功。 */
  async completeRun(runId: string, input: {
    answer: string; grounded: boolean; citedChunkIds: string[]; embeddingTokens: number;
    inputTokens: number; outputTokens: number; durationMs: number;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('rag_runs')}
       SET answer=$3, grounded=$4, cited_chunk_ids=$5::jsonb, embedding_tokens=$6,
           input_tokens=$7, output_tokens=$8, duration_ms=$9, status='completed', completed_at=now()
       WHERE tenant_id=$1 AND id=$2`,
      [this.tenantId, runId, input.answer, input.grounded, JSON.stringify(input.citedChunkIds),
        input.embeddingTokens, input.inputTokens, input.outputTokens, input.durationMs],
    );
  }

  /** 将已开始但未生成可信响应的运行标记为失败，同时保留原始问题与模型元数据。 */
  async failRun(runId: string, durationMs: number): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('rag_runs')}
       SET duration_ms=$3, status='failed', completed_at=now() WHERE tenant_id=$1 AND id=$2`,
      [this.tenantId, runId, durationMs],
    );
  }

  /** 分批列出过期会话，供可信回答模块先清理 checkpoint 再删除会话记录。 */
  async listExpiredConversations(): Promise<{ id: string; threadId: string }[]> {
    const result = await this.pool.query(
      `SELECT id, thread_id FROM ${this.table('rag_conversations')}
       WHERE tenant_id = $1 AND expires_at <= now() LIMIT 500`,
      [this.tenantId],
    );
    return result.rows.map((row) => ({ id: row.id, threadId: row.thread_id }));
  }

  /** 仅删除在执行时仍然过期的会话，避免与并发续期竞争时误删活跃会话。 */
  async deleteExpiredConversation(id: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table('rag_conversations')}
       WHERE tenant_id = $1 AND id = $2 AND expires_at <= now()`,
      [this.tenantId, id],
    );
  }
}
