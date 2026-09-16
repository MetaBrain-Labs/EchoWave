/**
 * 租户 ASR 默认增强配置 Repository。
 *
 * 持久化通用设置中的默认上下文，并以乐观锁保证并发编辑不会覆盖其他设备的修改。
 *
 * Responsibilities:
 * - 在固定租户边界内读取和更新默认上下文。
 * - 为尚未配置的旧租户返回空配置和 revision 0。
 *
 * Notes:
 * - 热词属于数据源设置，不在本 Repository 中重复保存。
 */
import {
  AsrPreferenceSchema,
  AsrPreferenceUpdateRequestSchema,
  type AsrPreference,
  type AsrPreferenceUpdateRequest,
} from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';
import { WorkspaceRepositoryError } from '../../errors.ts';

/** 为固定租户实现通用 ASR 默认上下文读写。 */
export class AsrPreferenceRepository {
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

  async get(): Promise<AsrPreference> {
    const result = await this.pool.query(
      `SELECT default_context, revision
       FROM ${this.table('asr_preferences')}
       WHERE tenant_id = $1`,
      [this.tenantId],
    );
    return AsrPreferenceSchema.parse({
      defaultContext: result.rows[0]?.default_context ?? '',
      revision: Number(result.rows[0]?.revision ?? 0),
    });
  }

  async update(rawInput: AsrPreferenceUpdateRequest): Promise<AsrPreference> {
    const input = AsrPreferenceUpdateRequestSchema.parse(rawInput);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE ${this.table('asr_preferences')}
         SET default_context = $3, revision = revision + 1, updated_at = now()
         WHERE tenant_id = $1 AND revision = $2
         RETURNING default_context, revision`,
        [this.tenantId, input.expectedRevision, input.defaultContext],
      );
      if (updated.rowCount === 0 && input.expectedRevision === 0) {
        const inserted = await client.query(
          `INSERT INTO ${this.table('asr_preferences')}
             (tenant_id, default_context, revision)
           VALUES ($1, $2, 1)
           ON CONFLICT (tenant_id) DO NOTHING
           RETURNING default_context, revision`,
          [this.tenantId, input.defaultContext],
        );
        if (inserted.rowCount) {
          await client.query('COMMIT');
          return AsrPreferenceSchema.parse({
            defaultContext: inserted.rows[0].default_context,
            revision: Number(inserted.rows[0].revision),
          });
        }
      }
      if (updated.rowCount === 0) {
        throw new WorkspaceRepositoryError(
          'CONFLICT',
          'ASR 默认上下文已被其他设备修改，请刷新后重试。',
        );
      }
      await client.query('COMMIT');
      return AsrPreferenceSchema.parse({
        defaultContext: updated.rows[0].default_context,
        revision: Number(updated.rows[0].revision),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
