/**
 * PostgreSQL 知识向量检索实现。
 *
 * 仅在租户和调用方知识库白名单内检索 active revision 的向量块。
 *
 * Responsibilities:
 * - 配置事务级 HNSW 检索参数。
 * - 执行内容去重、单文档配额与上下文字符预算。
 *
 * Notes:
 * - 知识目录 CRUD 由 catalog Repository 管理。
 */
import {
  SourceLocatorSchema,
  KnowledgeCategorySchema,
  KnowledgeCategoryFilterSchema,
} from '@echowave/contracts';
import { toSql } from 'pgvector';

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import type { KnowledgeSearchPort } from './port.ts';
import type { RetrievalChunk } from './types.ts';
import type { CategorySearchFilter, CategoryCatalogue } from './categoryPolicy.ts';

/** 基于 pgvector HNSW 的知识检索适配器。 */
export class PostgresKnowledgeSearch implements KnowledgeSearchPort {
  constructor(
    private readonly pool: DatabasePool,
    private readonly schema: string,
    private readonly tenantId: string,
  ) {}

  private table(name: string): string {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`;
  }
  /** 只给模型提供当前白名单内实际可用的类别和版本。 */
  async availableCategories(knowledgeBaseIds: string[]): Promise<CategoryCatalogue> {
    if (!knowledgeBaseIds.length) return { categories: [], versions: [] };
    const versions = await this.pool.query(
      `SELECT id,content_version,category_version FROM ${this.table('knowledge_bases')} WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id`,
      [this.tenantId, knowledgeBaseIds],
    );
    const categories = await this.pool.query(
      `SELECT cat.id,cat.key,cat.name,cat.description,cat.active,cat.version FROM ${this.table('knowledge_categories')} cat
      WHERE cat.tenant_id=$1 AND EXISTS (SELECT 1 FROM ${this.table('knowledge_bases')} kb WHERE kb.tenant_id=cat.tenant_id AND kb.id=ANY($2::uuid[]) AND kb.deleted_at IS NULL AND
        (kb.default_category_id=cat.id OR EXISTS (SELECT 1 FROM ${this.table('document_chunks')} c JOIN ${this.table('documents')} d ON d.tenant_id=c.tenant_id AND d.id=c.document_id AND d.active_revision_id=c.revision_id
          WHERE c.tenant_id=kb.tenant_id AND c.knowledge_base_id=kb.id AND c.category_id=cat.id AND d.deleted_at IS NULL AND d.status NOT IN ('deleted','deleting')))) ORDER BY cat.key NULLS LAST,cat.name`,
      [this.tenantId, knowledgeBaseIds],
    );
    return {
      categories: categories.rows.map((row) => KnowledgeCategorySchema.parse(row)),
      versions: versions.rows.map((row) => ({
        id: String(row.id),
        version: Number(row.content_version),
        categoryVersion: Number(row.category_version),
      })),
    };
  }

  /** 检索单个知识库并应用问答上下文预算。 */
  async search(
    knowledgeBaseId: string,
    embedding: number[],
    embeddingModel: string,
    filter?: CategorySearchFilter,
  ): Promise<RetrievalChunk[]> {
    const startedAt = Date.now();
    const result = await this.query([knowledgeBaseId], embedding, embeddingModel, 30, filter);
    const selected = this.select(result.rows, 8, 12_000);
    console.info('Knowledge retrieval completed', {
      knowledgeBaseId,
      candidateCount: result.rowCount ?? result.rows.length,
      selectedCount: selected.length,
      durationMs: Date.now() - startedAt,
    });
    return selected;
  }

  /** 在调用方给定的知识库白名单内执行一次全局检索。 */
  async searchMany(
    knowledgeBaseIds: string[],
    embedding: number[],
    embeddingModel: string,
    filter?: CategorySearchFilter,
  ): Promise<RetrievalChunk[]> {
    if (knowledgeBaseIds.length === 0) return [];
    const result = await this.query(knowledgeBaseIds, embedding, embeddingModel, 40, filter);
    return this.select(result.rows, 10, 14_000);
  }

  private async query(
    knowledgeBaseIds: string[],
    embedding: number[],
    embeddingModel: string,
    limit: number,
    filter?: CategorySearchFilter,
  ) {
    if (filter?.categoryIds?.length) KnowledgeCategoryFilterSchema.parse(filter.categoryIds);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL hnsw.ef_search = 100');
      await client.query("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
      const result = await client.query(
        `SELECT c.id, c.knowledge_base_id, c.document_id, c.revision_id, d.title AS document_title,
                c.content, c.content_sha256, c.locator, c.embedding <=> $3::vector AS distance
         FROM ${this.table('document_chunks')} c
         JOIN ${this.table('documents')} d
           ON d.tenant_id = c.tenant_id AND d.id = c.document_id
          AND d.knowledge_base_id=c.knowledge_base_id AND d.active_revision_id = c.revision_id
         JOIN ${this.table('knowledge_bases')} kb ON kb.tenant_id=c.tenant_id AND kb.id=c.knowledge_base_id AND kb.deleted_at IS NULL
         JOIN ${this.table('document_revisions')} r ON r.tenant_id=c.tenant_id AND r.document_id=d.id AND r.id=c.revision_id AND r.status='ready'
         WHERE c.tenant_id = $1 AND c.knowledge_base_id = ANY($2::uuid[])
           AND ($5::uuid[] IS NULL OR c.category_id=ANY($5::uuid[]))
           AND ($6::boolean OR c.category_id NOT IN (SELECT id FROM ${this.table('knowledge_categories')} WHERE tenant_id=$1 AND key='test'))
           AND d.deleted_at IS NULL AND d.status NOT IN ('deleted','deleting') AND c.embedding_model = $4 AND r.embedding_model=$4
         ORDER BY c.embedding <=> $3::vector LIMIT ${limit}`,
        [
          this.tenantId,
          knowledgeBaseIds,
          toSql(embedding),
          embeddingModel,
          filter?.categoryIds ?? null,
          filter?.includeTestSamples ?? false,
        ],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private select(rows: Record<string, any>[], maximum: number, characterLimit: number) {
    const hashes = new Set<string>();
    const perDocument = new Map<string, number>();
    const selected: RetrievalChunk[] = [];
    let characters = 0;
    for (const row of rows) {
      if (hashes.has(row.content_sha256)) continue;
      const count = perDocument.get(row.document_id) ?? 0;
      if (
        count >= 3 ||
        selected.length >= maximum ||
        characters + row.content.length > characterLimit
      ) {
        continue;
      }
      hashes.add(row.content_sha256);
      perDocument.set(row.document_id, count + 1);
      characters += row.content.length;
      selected.push({
        id: row.id,
        knowledgeBaseId: row.knowledge_base_id,
        documentId: row.document_id,
        revisionId: row.revision_id,
        documentTitle: row.document_title,
        content: row.content,
        locator: SourceLocatorSchema.parse(row.locator),
        distance: Number(row.distance),
      });
    }
    return selected;
  }
}
