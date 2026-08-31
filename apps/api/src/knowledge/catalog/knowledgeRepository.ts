/**
 * 知识目录持久层。
 *
 * 集中知识库、文档和文本块目录的租户范围 SQL。
 *
 * Responsibilities:
 * - 执行知识库与文档的租户隔离 CRUD。
 * - 维护知识目录和文档生命周期查询。
 *
 * Notes:
 * - 复杂 PostgreSQL 能力保留为显式 SQL，不在调用方重复实现。
 */
import {
  DocumentChunkSchema,
  KnowledgeBaseDetailSchema,
  KnowledgeBaseListResponseSchema,
  KnowledgeDocumentDetailSchema,
  KnowledgeDocumentListResponseSchema,
  KnowledgeDocumentSchema,
  SourceLocatorSchema,
  type KnowledgeBaseCreateRequest,
  type KnowledgeBaseDetail,
  type KnowledgeDocument,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import { RagRepositoryError } from '../persistence/errors.ts';

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
  if (
    kind === 'queued' ||
    kind === 'validating' ||
    kind === 'parsing' ||
    kind === 'chunking' ||
    kind === 'deleting'
  ) {
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
              coalesce(document_stats.document_count, 0)::int AS document_count,
              coalesce(group_stats.linked_group_count, 0)::int AS linked_group_count
       FROM ${this.table('knowledge_bases')} kb
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS document_count
         FROM ${this.table('documents')} d
         WHERE d.tenant_id = kb.tenant_id AND d.knowledge_base_id = kb.id AND d.deleted_at IS NULL
       ) document_stats ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS linked_group_count
         FROM ${this.table('group_knowledge_bases')} gkb
         JOIN ${this.table('groups')} g
           ON g.tenant_id = gkb.tenant_id AND g.id = gkb.group_id AND g.deleted_at IS NULL
         WHERE gkb.tenant_id = kb.tenant_id AND gkb.knowledge_base_id = kb.id
       ) group_stats ON true
       WHERE kb.tenant_id = $1 AND kb.deleted_at IS NULL
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

  async getKnowledgeBase(id: string): Promise<KnowledgeBaseDetail> {
    const result = await this.pool.query(
      `SELECT kb.id, kb.name, kb.description, kb.updated_at,
              kb.storage_location, kb.indexing_mode, kb.embedding_model,
              kb.reranker_model, kb.parsing_mode,
              coalesce(document_stats.document_count, 0)::int AS document_count,
              coalesce(document_stats.total_size_bytes, 0)::bigint AS total_size_bytes,
              coalesce(document_stats.parsed_document_count, 0)::int AS parsed_document_count,
              coalesce(document_stats.pending_document_count, 0)::int AS pending_document_count,
              document_stats.last_uploaded_at,
              coalesce(group_stats.linked_group_count, 0)::int AS linked_group_count
       FROM ${this.table('knowledge_bases')} kb
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS document_count,
                coalesce(sum(d.size_bytes), 0)::bigint AS total_size_bytes,
                count(*) FILTER (WHERE d.status = 'ready')::int AS parsed_document_count,
                count(*) FILTER (WHERE d.status NOT IN ('ready', 'deleting'))::int AS pending_document_count,
                max(d.created_at) AS last_uploaded_at
         FROM ${this.table('documents')} d
         WHERE d.tenant_id = kb.tenant_id AND d.knowledge_base_id = kb.id AND d.deleted_at IS NULL
       ) document_stats ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS linked_group_count
         FROM ${this.table('group_knowledge_bases')} gkb
         JOIN ${this.table('groups')} g
           ON g.tenant_id = gkb.tenant_id AND g.id = gkb.group_id AND g.deleted_at IS NULL
         WHERE gkb.tenant_id = kb.tenant_id AND gkb.knowledge_base_id = kb.id
       ) group_stats ON true
       WHERE kb.tenant_id = $1 AND kb.id = $2 AND kb.deleted_at IS NULL
       `,
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
      settings: {
        storageLocation: row.storage_location,
        indexingMode: row.indexing_mode,
        embeddingModel: row.embedding_model,
        rerankerModel: row.reranker_model ?? null,
        parsingMode: row.parsing_mode,
      },
      totalSizeBytes: Number(row.total_size_bytes),
      parsedDocumentCount: row.parsed_document_count,
      pendingDocumentCount: row.pending_document_count,
      lastUploadedAt: row.last_uploaded_at ? iso(row.last_uploaded_at) : null,
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
}
