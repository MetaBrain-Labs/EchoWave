/**
 * 收集文件夹目录仓储。
 *
 * Responsibilities:
 * - 按租户、目标库和稳定规则身份组织独立案例。
 * - 历史整理只写归属元数据，不触发入库和媒体流程。
 * Notes:
 * - 原文档接口仍是文件详情的权威来源。
 */
import type { PoolClient } from 'pg';
import {
  CollectionFolderSchema,
  CollectionFolderContentsSchema,
  KnowledgeDirectorySchema,
  type FrozenCollectionRule,
  type OrganizeCollectionCases,
} from '@echowave/contracts';
import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import { RagRepositoryError } from '../persistence/errors.ts';

/** 当前租户的规则文件夹与案例归属。 */
export class CollectionFolderRepository {
  constructor(
    private readonly pool: DatabasePool,
    private readonly schema: string,
    private readonly tenantId: string,
  ) {}
  private table(name: string) {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`;
  }
  /** 同事务建立归属；重复命中不会更改案例正文或审核状态。 */
  async link(
    client: PoolClient,
    caseId: string,
    rule: FrozenCollectionRule,
    origin: 'matched' | 'organized' = 'matched',
  ) {
    const owner = await client.query(
      `SELECT c.knowledge_base_id FROM ${this.table('knowledge_cases')} c
      JOIN ${this.table('collection_rules')} r ON r.tenant_id=c.tenant_id AND r.group_id=c.group_id AND r.id=$3
      WHERE c.tenant_id=$1 AND c.id=$2 AND c.knowledge_base_id=$4`,
      [this.tenantId, caseId, rule.id, rule.input.knowledgeBaseId],
    );
    if (!owner.rowCount)
      throw new RagRepositoryError('CONFLICT', '案例与规则不属于同一知识库或分组。');
    await client.query(
      `INSERT INTO ${this.table('collection_folders')}(tenant_id,knowledge_base_id,kind,rule_id)
      VALUES($1,$2,'rule',$3) ON CONFLICT DO NOTHING`,
      [this.tenantId, rule.input.knowledgeBaseId, rule.id],
    );
    await client.query(
      `INSERT INTO ${this.table('collection_case_folders')}(tenant_id,folder_id,case_id,origin,rule_version,rule_snapshot)
      SELECT $1,id,$3,$4,$5,$6::jsonb FROM ${this.table('collection_folders')}
      WHERE tenant_id=$1 AND knowledge_base_id=$2 AND rule_id=$7 ON CONFLICT DO NOTHING`,
      [
        this.tenantId,
        rule.input.knowledgeBaseId,
        caseId,
        origin,
        rule.version,
        JSON.stringify(rule.input),
        rule.id,
      ],
    );
    await client.query(
      `DELETE FROM ${this.table('collection_case_folders')} m USING ${this.table('collection_folders')} f
      WHERE m.tenant_id=$1 AND m.case_id=$2 AND f.tenant_id=m.tenant_id AND f.id=m.folder_id AND f.kind<>'rule'`,
      [this.tenantId, caseId],
    );
  }
  private async knowledge(id: string) {
    const r = await this.pool.query(
      `SELECT 1 FROM ${this.table('knowledge_bases')}
      WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [this.tenantId, id],
    );
    if (!r.rowCount) throw new RagRepositoryError('NOT_FOUND', '知识库不存在。');
  }
  private folderSql() {
    return `SELECT f.id,f.knowledge_base_id,f.kind,f.rule_id,r.group_id,
      CASE WHEN f.kind='rule' THEN r.data->>'name' WHEN f.kind='manual' THEN '手动收集' ELSE '历史收集' END AS name,
      count(c.id)::int AS case_count,greatest(f.created_at,max(c.updated_at),max(m.created_at),r.updated_at) AS updated_at
      FROM ${this.table('collection_folders')} f
      LEFT JOIN ${this.table('collection_rules')} r ON r.tenant_id=f.tenant_id AND r.id=f.rule_id
      LEFT JOIN ${this.table('collection_case_folders')} m ON m.tenant_id=f.tenant_id AND m.folder_id=f.id
      LEFT JOIN ${this.table('knowledge_cases')} c ON c.tenant_id=m.tenant_id AND c.id=m.case_id AND c.status='published'
      WHERE f.tenant_id=$1 AND f.knowledge_base_id=$2`;
  }
  private folder(row: Record<string, unknown>) {
    return CollectionFolderSchema.parse({
      id: row.id,
      knowledgeBaseId: row.knowledge_base_id,
      kind: row.kind,
      ruleId: row.rule_id,
      groupId: row.group_id ?? null,
      name: row.name,
      caseCount: row.case_count,
      updatedAt: new Date(row.updated_at as string).toISOString(),
    });
  }
  /** 根目录搜索同时覆盖目录名和内部案例文档名。 */
  async directory(knowledgeId: string, query = '') {
    await this.knowledge(knowledgeId);
    const folders = await this.pool.query(
      `${this.folderSql()} GROUP BY f.id,r.id HAVING count(c.id)>0`,
      [this.tenantId, knowledgeId],
    );
    const docs = await this.pool.query(
      `SELECT id,title,updated_at FROM ${this.table('documents')}
      WHERE tenant_id=$1 AND knowledge_base_id=$2 AND deleted_at IS NULL AND knowledge_case_id IS NULL`,
      [this.tenantId, knowledgeId],
    );
    const needle = query.trim().toLocaleLowerCase();
    const items: Array<Record<string, unknown>> = docs.rows
      .filter((row) => row.title.toLocaleLowerCase().includes(needle))
      .map((row) => ({
        kind: 'document',
        documentId: row.id,
        updatedAt: new Date(row.updated_at).toISOString(),
      }));
    for (const row of folders.rows) {
      const folder = this.folder(row);
      if (
        needle &&
        !folder.name.toLocaleLowerCase().includes(needle) &&
        !(await this.contents(knowledgeId, folder.id, query)).items.length
      )
        continue;
      items.push({ kind: 'folder', folder, updatedAt: folder.updatedAt });
    }
    items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return KnowledgeDirectorySchema.parse({ items });
  }
  /** 文件夹名命中时保留全部子项；否则只返回标题命中的案例。 */
  async contents(knowledgeId: string, folderId: string, query = '') {
    await this.knowledge(knowledgeId);
    const folders = await this.pool.query(`${this.folderSql()} AND f.id=$3 GROUP BY f.id,r.id`, [
      this.tenantId,
      knowledgeId,
      folderId,
    ]);
    if (!folders.rowCount) throw new RagRepositoryError('NOT_FOUND', '收集文件夹不存在。');
    const folder = this.folder(folders.rows[0]);
    const r = await this.pool.query(
      `SELECT c.id,c.document_id,c.group_id,c.version,coalesce(d.title,v.content->>'title') AS title
      FROM ${this.table('collection_case_folders')} m JOIN ${this.table('knowledge_cases')} c ON c.tenant_id=m.tenant_id AND c.id=m.case_id
      JOIN ${this.table('knowledge_case_versions')} v ON v.tenant_id=c.tenant_id AND v.case_id=c.id AND v.version=c.version
      LEFT JOIN ${this.table('documents')} d ON d.tenant_id=c.tenant_id AND d.id=c.document_id AND d.deleted_at IS NULL
      WHERE m.tenant_id=$1 AND m.folder_id=$2 AND c.knowledge_base_id=$3 AND c.status='published' ORDER BY c.updated_at DESC`,
      [this.tenantId, folderId, knowledgeId],
    );
    const needle = query.trim().toLocaleLowerCase();
    return CollectionFolderContentsSchema.parse({
      folder,
      items: r.rows
        .filter(
          (row) =>
            folder.name.toLocaleLowerCase().includes(needle) ||
            row.title.toLocaleLowerCase().includes(needle),
        )
        .map((row) => ({
          caseId: row.id,
          documentId: row.document_id,
          groupId: row.group_id,
          title: row.title,
          version: row.version,
        })),
    });
  }
  /** 每项独立提交，版本冲突或跨分组失败保留其原历史归属。 */
  async organize(knowledgeId: string, folderId: string, input: OrganizeCollectionCases) {
    const current = await this.contents(knowledgeId, folderId);
    if (current.folder.kind !== 'legacy')
      throw new RagRepositoryError('CONFLICT', '只能整理历史收集文件夹。');
    const items = [];
    for (const item of input.items) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const kb = await client.query(
          `SELECT id FROM ${this.table('knowledge_bases')} WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,
          [this.tenantId, knowledgeId],
        );
        const c = await client.query(
          `SELECT c.id FROM ${this.table('knowledge_cases')} c JOIN ${this.table('collection_case_folders')} m
          ON m.tenant_id=c.tenant_id AND m.case_id=c.id WHERE c.tenant_id=$1 AND c.id=$2 AND c.version=$3
          AND c.status='published' AND c.knowledge_base_id=$4 AND m.folder_id=$5 FOR UPDATE OF c`,
          [this.tenantId, item.id, item.expectedVersion, knowledgeId, folderId],
        );
        const r = await client.query(
          `SELECT * FROM ${this.table('collection_rules')} WHERE tenant_id=$1 AND id=$2 AND knowledge_base_id=$3 FOR SHARE`,
          [this.tenantId, input.ruleId, knowledgeId],
        );
        if (!kb.rowCount || !c.rowCount || !r.rowCount)
          throw new RagRepositoryError('CONFLICT', '案例或规则状态已变化。');
        await this.link(
          client,
          item.id,
          { id: r.rows[0].id, version: r.rows[0].version, input: r.rows[0].data },
          'organized',
        );
        await client.query('COMMIT');
        items.push({ id: item.id, success: true, message: null });
      } catch {
        await client.query('ROLLBACK');
        items.push({ id: item.id, success: false, message: '归类未完成，请读取最新状态后重试。' });
      } finally {
        client.release();
      }
    }
    return { items };
  }
}
