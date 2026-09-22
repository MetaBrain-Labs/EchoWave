/**
 * 知识检索设置 PostgreSQL Repository。
 *
 * 为固定租户持久化智能重排开关与乐观锁 revision。
 *
 * Responsibilities:
 * - 为新租户按需补齐默认开启记录。
 * - 使用单条条件更新防止并发覆盖。
 *
 * Notes:
 * - 模型和连接就绪状态由应用服务解析，不在本表重复存储。
 */
import type { KnowledgeRetrievalSettingsUpdateRequest } from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import { SettingsError } from '../../settings/types.ts';

export type StoredKnowledgeRetrievalSettings = { rerankEnabled: boolean; revision: number };

/** 读写固定租户的知识检索设置。 */
export class KnowledgeRetrievalSettingsRepository {
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

  /** 返回当前设置，并为迁移后新增租户补齐默认开启记录。 */
  async get(): Promise<StoredKnowledgeRetrievalSettings> {
    await this.pool.query(
      `INSERT INTO ${this.table('tenant_knowledge_retrieval_settings')} (tenant_id)
       VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [this.tenantId],
    );
    const result = await this.pool.query(
      `SELECT rerank_enabled, revision
       FROM ${this.table('tenant_knowledge_retrieval_settings')} WHERE tenant_id=$1`,
      [this.tenantId],
    );
    const row = result.rows[0]!;
    return { rerankEnabled: Boolean(row.rerank_enabled), revision: Number(row.revision) };
  }

  /** 按 expectedRevision 更新开关；冲突时不改写服务器状态。 */
  async update(
    input: KnowledgeRetrievalSettingsUpdateRequest,
  ): Promise<StoredKnowledgeRetrievalSettings> {
    const result = await this.pool.query(
      `UPDATE ${this.table('tenant_knowledge_retrieval_settings')}
       SET rerank_enabled=$3, revision=revision+1, updated_at=now()
       WHERE tenant_id=$1 AND revision=$2 RETURNING rerank_enabled, revision`,
      [this.tenantId, input.expectedRevision, input.rerankEnabled],
    );
    if (!result.rowCount) {
      throw new SettingsError('CONFLICT', '知识检索设置已被其他管理员修改，请刷新后重试。');
    }
    return {
      rerankEnabled: Boolean(result.rows[0].rerank_enabled),
      revision: Number(result.rows[0].revision),
    };
  }
}
