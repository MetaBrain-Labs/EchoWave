/**
 * 租户音频运行模式 PostgreSQL Repository。
 *
 * 持久化当前模式、保留策略与乐观锁 revision，并为新租户补齐默认混合模式。
 *
 * Responsibilities:
 * - 所有读写限定在固定租户。
 * - 通过 revision 防止多个管理员互相覆盖配置。
 *
 * Notes:
 * - 资产自身的模式快照由上传领域负责，配置变更不追溯已有资产。
 */
import type { AudioRuntimeMode, AudioRuntimeUpdateRequest } from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';
import { SettingsError } from '../../../settings/types.ts';

export type StoredAudioRuntimeSettings = {
  mode: AudioRuntimeMode;
  revision: number;
  originalRetentionDays: number | null;
  intermediateRetentionHours: number;
};

/** 为固定租户读写音频运行模式。 */
export class AudioRuntimeRepository {
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

  async get(): Promise<StoredAudioRuntimeSettings> {
    await this.pool.query(
      `INSERT INTO ${this.table('tenant_audio_runtime_settings')} (tenant_id)
       VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [this.tenantId],
    );
    const result = await this.pool.query<{
      mode: AudioRuntimeMode;
      revision: number;
      original_retention_days: number | null;
      intermediate_retention_hours: number;
    }>(
      `SELECT mode, revision, original_retention_days, intermediate_retention_hours
       FROM ${this.table('tenant_audio_runtime_settings')}
       WHERE tenant_id = $1`,
      [this.tenantId],
    );
    const row = result.rows[0]!;
    return {
      mode: row.mode,
      revision: Number(row.revision),
      originalRetentionDays:
        row.original_retention_days === null ? null : Number(row.original_retention_days),
      intermediateRetentionHours: Number(row.intermediate_retention_hours),
    };
  }

  async update(input: AudioRuntimeUpdateRequest): Promise<StoredAudioRuntimeSettings> {
    const result = await this.pool.query(
      `UPDATE ${this.table('tenant_audio_runtime_settings')}
       SET mode = $3, original_retention_days = $4, intermediate_retention_hours = $5,
           revision = revision + 1, updated_at = now()
       WHERE tenant_id = $1 AND revision = $2
       RETURNING tenant_id`,
      [
        this.tenantId,
        input.expectedRevision,
        input.mode,
        input.retention.originalRetentionDays,
        input.retention.intermediateRetentionHours,
      ],
    );
    if (!result.rowCount) {
      throw new SettingsError('CONFLICT', '运行模式已被其他管理员修改，请刷新后重试。');
    }
    return this.get();
  }
}
