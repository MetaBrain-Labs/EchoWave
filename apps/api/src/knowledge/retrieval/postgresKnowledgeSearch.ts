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
import { SourceLocatorSchema } from '@echowave/contracts';
import { toSql } from 'pgvector';

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import type { KnowledgeSearchPort } from './port.ts';
import type { RetrievalChunk } from './types.ts';

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

  /** 检索单个知识库并应用问答上下文预算。 */
  async search(
    knowledgeBaseId: string,
    embedding: number[],
    embeddingModel: string,
  ): Promise<RetrievalChunk[]> {
    const startedAt = Date.now();
    const result = await this.query([knowledgeBaseId], embedding, embeddingModel, 30);
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
  ): Promise<RetrievalChunk[]> {
    if (knowledgeBaseIds.length === 0) return [];
    const result = await this.query(knowledgeBaseIds, embedding, embeddingModel, 40);
    return this.select(result.rows, 10, 14_000);
  }

  private async query(
    knowledgeBaseIds: string[],
    embedding: number[],
    embeddingModel: string,
    limit: number,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL hnsw.ef_search = 100');
      await client.query("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
      const result = await client.query(
        `SELECT c.id, c.knowledge_base_id, c.document_id, d.title AS document_title,
                c.content, c.content_sha256, c.locator, c.embedding <=> $3::vector AS distance
         FROM ${this.table('document_chunks')} c
         JOIN ${this.table('documents')} d
           ON d.tenant_id = c.tenant_id AND d.id = c.document_id
          AND d.active_revision_id = c.revision_id
         WHERE c.tenant_id = $1 AND c.knowledge_base_id = ANY($2::uuid[])
           AND d.deleted_at IS NULL AND c.embedding_model = $4
         ORDER BY c.embedding <=> $3::vector LIMIT ${limit}`,
        [this.tenantId, knowledgeBaseIds, toSql(embedding), embeddingModel],
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
        documentTitle: row.document_title,
        content: row.content,
        locator: SourceLocatorSchema.parse(row.locator),
        distance: Number(row.distance),
      });
    }
    return selected;
  }
}
