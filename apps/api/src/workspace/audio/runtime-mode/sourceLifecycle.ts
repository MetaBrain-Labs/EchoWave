/**
 * 轻量本地源音频生命周期管理器。
 *
 * 在 ASR 或绑定声学情绪成功后幂等删除本地原音频，并把清理事实与 Checkpoint 一起写回 PostgreSQL。
 *
 * Responsibilities:
 * - 只允许清理资产创建时固化为 lightweight_local 的源文件。
 * - 文件缺失时仍收敛为 cleaned，避免补偿任务永久重试。
 *
 * Notes:
 * - 对象存储生命周期由企业策略和独立清理任务处理。
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';
import type { PrimaryOssStore } from './primaryOssStore.ts';

/** 清理固定租户的轻量源文件。 */
export class AudioSourceLifecycle {
  private readonly schema: string;

  constructor(
    private readonly pool: DatabasePool,
    schema: string,
    private readonly tenantId: string,
    private readonly audioStorageDirectory: string,
  ) {
    this.schema = quoteIdentifier(schema);
  }

  private table(name: string): string {
    return `${this.schema}.${quoteIdentifier(name)}`;
  }

  /** 在指定 revision 的必需能力全部成功后删除原音频与记录定位键。 */
  async cleanup(audioFileId: string, revisionId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT storage_key
       FROM ${this.table('audio_files')} af
       JOIN ${this.table('audio_analysis_revisions')} ar
         ON ar.tenant_id = af.tenant_id AND ar.audio_file_id = af.id
       WHERE af.tenant_id = $1 AND af.id = $2 AND ar.id = $3
         AND af.runtime_mode = 'lightweight_local' AND af.source_state = 'available'
         AND ar.status = 'ready'
         AND (
           ar.include_acoustic_emotion = false OR
           ar.processing_checkpoint = 'acoustic_emotion_completed'
         )`,
      [this.tenantId, audioFileId, revisionId],
    );
    const storageKey = result.rows[0]?.storage_key as string | undefined;
    if (!storageKey) return;
    await this.pool.query(
      `UPDATE ${this.table('audio_files')}
       SET cleanup_status = 'pending', source_delete_after = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, audioFileId],
    );
    const root = path.resolve(this.audioStorageDirectory);
    const target = path.resolve(root, storageKey);
    if (!target.startsWith(`${root}${path.sep}`))
      throw new Error('Invalid lightweight source path.');
    await rm(target, { force: true });
    await this.pool.query(
      `UPDATE ${this.table('audio_files')} af
       SET storage_key = NULL, source_state = 'cleaned', cleanup_status = 'completed',
           source_recovery_state = 'required', source_delete_after = NULL, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND runtime_mode = 'lightweight_local'`,
      [this.tenantId, audioFileId],
    );
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_revisions')}
       SET processing_checkpoint = 'cleanup_completed'
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, revisionId],
    );
  }

  /** 清理达到期限的轻量源文件或企业 OSS 原音频，并把失败留给下次补偿。 */
  async cleanupDue(
    resolvePrimary: (bindingRevisionId: string) => Promise<PrimaryOssStore>,
  ): Promise<void> {
    const due = await this.pool.query(
      `SELECT id, storage_key, storage_backend, storage_binding_revision_id
       FROM ${this.table('audio_files')} af
       WHERE af.tenant_id = $1 AND af.source_state = 'available'
         AND af.source_delete_after IS NOT NULL AND af.source_delete_after <= now()
         AND NOT EXISTS (
           SELECT 1 FROM ${this.table('audio_analysis_revisions')} ar
           WHERE ar.tenant_id = af.tenant_id AND ar.audio_file_id = af.id
             AND ar.status IN ('queued', 'transcribing', 'analyzing')
         )
         AND NOT EXISTS (
           SELECT 1 FROM ${this.table('audio_post_analysis_jobs')} job
           WHERE job.tenant_id = af.tenant_id AND job.audio_file_id = af.id
             AND job.analysis_type = 'emotion' AND job.status IN ('queued', 'running')
         )
       ORDER BY source_delete_after LIMIT 100`,
      [this.tenantId],
    );
    for (const row of due.rows) {
      try {
        if (row.storage_backend === 'aliyun_oss') {
          if (!row.storage_binding_revision_id) throw new Error('Missing storage binding.');
          await (await resolvePrimary(row.storage_binding_revision_id)).delete(row.storage_key);
        } else {
          const root = path.resolve(this.audioStorageDirectory);
          const target = path.resolve(root, row.storage_key);
          if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid source path.');
          await rm(target, { force: true });
        }
        await this.pool.query(
          `UPDATE ${this.table('audio_files')}
           SET storage_key = NULL, source_state = 'cleaned', cleanup_status = 'completed',
               source_recovery_state = CASE WHEN runtime_mode = 'lightweight_local'
                 THEN 'required' ELSE 'not_required' END,
               source_delete_after = NULL, updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [this.tenantId, row.id],
        );
      } catch {
        await this.pool.query(
          `UPDATE ${this.table('audio_files')}
           SET cleanup_status = 'failed', updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [this.tenantId, row.id],
        );
      }
    }
  }
}
