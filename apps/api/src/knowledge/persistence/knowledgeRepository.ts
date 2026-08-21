/**
 * 知识目录与检索持久层。
 *
 * 集中知识库、文档、文本块和 active revision 向量检索的租户范围 SQL。
 *
 * Responsibilities:
 * - 执行知识库与文档的租户隔离 CRUD。
 * - 执行只读取 active revision 的 pgvector 检索。
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
  type KnowledgeBaseCreateRequest,
  type KnowledgeBaseSummary,
  type KnowledgeDocument,
  type SourceLocator,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import { RagRepositoryError } from './errors.ts';

/** 向可信回答模块返回的可引用检索结果。 */
export type RetrievalChunk = {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  locator: SourceLocator;
  distance: number;
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

/** 隐藏知识目录、文档读取和 active revision 检索 SQL 的 PostgreSQL 仓储。 */
export class KnowledgeRepository {
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
              count(DISTINCT d.id)::int AS document_count,
              count(DISTINCT gkb.group_id)::int AS linked_group_count
       FROM ${this.table('knowledge_bases')} kb
       LEFT JOIN ${this.table('documents')} d
         ON d.tenant_id = kb.tenant_id AND d.knowledge_base_id = kb.id AND d.deleted_at IS NULL
       LEFT JOIN ${this.table('group_knowledge_bases')} gkb
         ON gkb.tenant_id = kb.tenant_id AND gkb.knowledge_base_id = kb.id
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
        linkedGroupCount: row.linked_group_count,
        updatedAt: iso(row.updated_at),
      })),
    });
  }

  async getKnowledgeBase(id: string): Promise<KnowledgeBaseSummary> {
    const result = await this.pool.query(
      `SELECT kb.id, kb.name, kb.description, kb.updated_at,
              count(DISTINCT d.id)::int AS document_count,
              count(DISTINCT gkb.group_id)::int AS linked_group_count
       FROM ${this.table('knowledge_bases')} kb
       LEFT JOIN ${this.table('documents')} d
         ON d.tenant_id = kb.tenant_id AND d.knowledge_base_id = kb.id AND d.deleted_at IS NULL
       LEFT JOIN ${this.table('group_knowledge_bases')} gkb
         ON gkb.tenant_id = kb.tenant_id AND gkb.knowledge_base_id = kb.id
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
      linkedGroupCount: row.linked_group_count,
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

}
