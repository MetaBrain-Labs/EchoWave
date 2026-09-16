/**
 * 知识类别持久层。
 *
 * 保存租户类别目录、活动文档 revision 的人工覆盖与非生效模型建议。
 *
 * Responsibilities:
 * - 在知识库锁和版本校验下修改分类元数据。
 * - 使用数据库触发器原子维护文本块类别与知识版本。
 *
 * Notes:
 * - 不修改正文、引用快照或 embedding。
 */
import {
  DocumentClassificationSchema,
  KnowledgeCategorySchema,
  SourceLocatorSchema,
  type KnowledgeCategoryCreate,
  type KnowledgeCategoryUpdate,
  type DocumentClassificationUpdate,
  type ClassificationSuggestion,
} from '@echowave/contracts';
import type { PoolClient } from 'pg';
import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import { RagRepositoryError } from '../persistence/errors.ts';

/** 类别目录和文档分类的窄生命周期仓储。 */
export class KnowledgeCategoryRepository {
  constructor(
    private readonly pool: DatabasePool,
    private readonly schema: string,
    private readonly tenantId: string,
  ) {}
  private table(name: string) {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`;
  }
  /** 返回当前租户目录，停用项仍显示历史归属。 */
  async list() {
    const result = await this.pool.query(
      `SELECT id,key,name,description,active,version FROM ${this.table('knowledge_categories')} WHERE tenant_id=$1 ORDER BY key NULLS LAST,name`,
      [this.tenantId],
    );
    return { items: result.rows.map((row) => KnowledgeCategorySchema.parse(row)) };
  }
  /** 新增类别时锁定知识库，目录版本变化与在途分析发布互斥。 */
  async create(input: KnowledgeCategoryCreate) {
    return this.catalogWrite(async (client) => {
      const result = await client.query(
        `INSERT INTO ${this.table('knowledge_categories')}(tenant_id,name,description) VALUES($1,$2,$3) RETURNING id,key,name,description,active,version`,
        [this.tenantId, input.name, input.description],
      );
      return KnowledgeCategorySchema.parse(result.rows[0]);
    });
  }
  /** 乐观维护类别；通用兜底类别不能停用。 */
  async update(id: string, input: KnowledgeCategoryUpdate) {
    return this.catalogWrite(async (client) => {
      const current = await client.query(
        `SELECT key,version FROM ${this.table('knowledge_categories')} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [this.tenantId, id],
      );
      if (!current.rowCount) throw new RagRepositoryError('NOT_FOUND', '类别不存在。');
      if (current.rows[0].version !== input.expectedVersion)
        throw new RagRepositoryError('CONFLICT', '类别版本已变化，请刷新后重试。');
      if (current.rows[0].key === 'general' && input.active === false)
        throw new RagRepositoryError('CONFLICT', '通用资料类别不能停用。');
      const result = await client.query(
        `UPDATE ${this.table('knowledge_categories')} SET name=coalesce($3,name),description=coalesce($4,description),active=coalesce($5,active),version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING id,key,name,description,active,version`,
        [this.tenantId, id, input.name ?? null, input.description ?? null, input.active ?? null],
      );
      return KnowledgeCategorySchema.parse(result.rows[0]);
    });
  }
  private async catalogWrite<T>(write: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT id FROM ${this.table('knowledge_bases')} WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
        [this.tenantId],
      );
      const value = await write(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new RagRepositoryError('CONFLICT', '类别名称已存在。');
      throw error;
    } finally {
      client.release();
    }
  }
  /** 读取当前活动版本，不把旧建议错误应用到新文件。 */
  async getClassification(
    knowledgeId: string,
    documentId: string,
    reader: DatabasePool | PoolClient = this.pool,
  ) {
    const result = await reader.query(
      `SELECT r.id,r.classification_version,r.confirmed_category_id,r.sheet_categories,r.category_suggestion,d.version,kb.default_category_id,
      coalesce((SELECT jsonb_agg(DISTINCT c.locator->>'sheet') FROM ${this.table('document_chunks')} c WHERE c.tenant_id=r.tenant_id AND c.revision_id=r.id AND c.locator->>'kind'='spreadsheet'),'[]'::jsonb) AS sheets
      FROM ${this.table('knowledge_bases')} kb JOIN ${this.table('documents')} d ON d.tenant_id=kb.tenant_id AND d.knowledge_base_id=kb.id
      JOIN ${this.table('document_revisions')} r ON r.tenant_id=d.tenant_id AND r.id=d.active_revision_id AND r.document_id=d.id
      WHERE kb.tenant_id=$1 AND kb.id=$2 AND d.id=$3 AND kb.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status NOT IN ('deleting','deleted') AND r.status='ready'`,
      [this.tenantId, knowledgeId, documentId],
    );
    if (!result.rowCount) throw new RagRepositoryError('NOT_FOUND', '文档尚无可分类的活动版本。');
    const row = result.rows[0];
    return DocumentClassificationSchema.parse({
      revisionId: row.id,
      version: row.classification_version,
      documentVersion: row.version,
      defaultCategoryId: row.default_category_id,
      documentCategoryId: row.confirmed_category_id,
      sheets: row.sheets,
      sheetAssignments: Object.entries(row.sheet_categories).map(([sheet, categoryId]) => ({
        sheet,
        categoryId,
      })),
      suggestion: row.category_suggestion,
    });
  }
  /** 确认分类只更新 revision 元数据，由触发器传播到检索块。 */
  async updateClassification(
    knowledgeId: string,
    documentId: string,
    input: DocumentClassificationUpdate,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockKnowledge(client, knowledgeId);
      const current = await this.getClassification(knowledgeId, documentId, client);
      if (
        current.revisionId !== input.revisionId ||
        current.version !== input.expectedVersion ||
        current.documentVersion !== input.expectedDocumentVersion
      )
        throw new RagRepositoryError('CONFLICT', '文档或分类版本已变化，请刷新后重试。');
      if (input.sheetAssignments.some((item) => !current.sheets.includes(item.sheet)))
        throw new RagRepositoryError('CONFLICT', '分类包含不存在的工作表。');
      // 停用类别可保留原归属，但不能被新分配到其他文档或工作表。
      const inheritedSheets = new Map(
        current.sheetAssignments.map((item) => [item.sheet, item.categoryId]),
      );
      const ids = [
        ...new Set(
          [
            input.documentCategoryId !== current.documentCategoryId
              ? input.documentCategoryId
              : null,
            ...input.sheetAssignments
              .filter((item) => inheritedSheets.get(item.sheet) !== item.categoryId)
              .map((item) => item.categoryId),
          ].filter((id): id is string => id !== null),
        ),
      ];
      if (ids.length) {
        const categories = await client.query(
          `SELECT id FROM ${this.table('knowledge_categories')} WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND active FOR SHARE`,
          [this.tenantId, ids],
        );
        if (categories.rowCount !== ids.length)
          throw new RagRepositoryError('CONFLICT', '只能指定当前租户的启用类别。');
      }
      const suggestion =
        input.confirmSuggestion && current.suggestion?.status === 'pending'
          ? { ...current.suggestion, status: 'confirmed' }
          : current.suggestion;
      await client.query(
        `UPDATE ${this.table('document_revisions')} SET confirmed_category_id=$3,sheet_categories=$4::jsonb,category_suggestion=$5::jsonb WHERE tenant_id=$1 AND id=$2`,
        [
          this.tenantId,
          input.revisionId,
          input.documentCategoryId,
          JSON.stringify(
            Object.fromEntries(input.sheetAssignments.map((item) => [item.sheet, item.categoryId])),
          ),
          JSON.stringify(suggestion),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.getClassification(knowledgeId, documentId);
  }
  /** 读取已发布文本用于按需分类，不要求原文件仍然存在。 */
  async classificationSample(knowledgeId: string, documentId: string) {
    const classification = await this.getClassification(knowledgeId, documentId);
    const result = await this.pool.query(
      `SELECT c.content,c.locator,d.title FROM ${this.table('document_chunks')} c JOIN ${this.table('documents')} d ON d.tenant_id=c.tenant_id AND d.id=c.document_id WHERE c.tenant_id=$1 AND c.knowledge_base_id=$2 AND c.document_id=$3 AND c.revision_id=$4 ORDER BY c.chunk_index`,
      [this.tenantId, knowledgeId, documentId, classification.revisionId],
    );
    return {
      classification,
      title: String(result.rows[0]?.title ?? documentId),
      chunks: result.rows.map((row) => ({
        content: String(row.content),
        locator: SourceLocatorSchema.parse(row.locator),
      })),
    };
  }
  /** 模型建议使用 CAS 保存，用户确认或替换文件后旧请求不得覆盖。 */
  async saveSuggestion(
    knowledgeId: string,
    documentId: string,
    revisionId: string,
    version: number,
    suggestion: ClassificationSuggestion,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockKnowledge(client, knowledgeId);
      const result = await client.query(
        `UPDATE ${this.table('document_revisions')} r SET category_suggestion=$5::jsonb FROM ${this.table('documents')} d
        WHERE r.tenant_id=$1 AND r.id=$3 AND r.classification_version=$4 AND d.tenant_id=r.tenant_id AND d.id=$2 AND d.knowledge_base_id=$6 AND d.active_revision_id=r.id AND d.deleted_at IS NULL`,
        [this.tenantId, documentId, revisionId, version, JSON.stringify(suggestion), knowledgeId],
      );
      if (!result.rowCount)
        throw new RagRepositoryError('CONFLICT', '文档或分类版本已变化，请刷新后重试。');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.getClassification(knowledgeId, documentId);
  }
  private async lockKnowledge(client: PoolClient, knowledgeId: string) {
    const result = await client.query(
      `SELECT id FROM ${this.table('knowledge_bases')} WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,
      [this.tenantId, knowledgeId],
    );
    if (!result.rowCount) throw new RagRepositoryError('NOT_FOUND', '知识库不存在。');
  }
}
