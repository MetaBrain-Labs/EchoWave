/**
 * 音频上传会话 PostgreSQL Repository。
 *
 * 原子创建上传批次、AudioAsset 与会话，并负责完成确认、失败和源文件状态推进。
 *
 * Responsibilities:
 * - 固化资产创建时的运行模式、存储绑定 revision 与保留策略。
 * - 对会话状态转换实施租户隔离和幂等约束。
 *
 * Notes:
 * - 二进制写入和供应商对象校验由应用服务执行。
 */
import type { AudioRuntimeMode, AudioUploadSessionCreateRequest } from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';
import { WorkspaceRepositoryError } from '../../errors.ts';

export type StoredUploadSession = {
  id: string;
  audioFileId: string;
  dataSourceId: string;
  mode: AudioRuntimeMode;
  strategy: 'api_binary' | 'presigned_put';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  storageBindingRevisionId: string | null;
  includeAcousticEmotion: boolean;
  status: 'created' | 'uploaded' | 'validating' | 'ready' | 'failed' | 'expired';
  expiresAt: Date;
};

/** 持久化固定租户的上传会话。 */
export class AudioUploadSessionRepository {
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

  /** 原子创建 ingestion run、待上传 AudioAsset 和上传会话。 */
  async create(
    dataSourceId: string,
    input: AudioUploadSessionCreateRequest,
    settings: {
      mode: AudioRuntimeMode;
      originalRetentionDays: number | null;
      revision: number;
    },
    storage: {
      backend: 'local_ephemeral' | 'aliyun_oss';
      bindingRevisionId: string | null;
      key: string;
      strategy: StoredUploadSession['strategy'];
    },
  ): Promise<StoredUploadSession> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const source = await client.query(
        `SELECT id FROM ${this.table('data_sources')}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR SHARE`,
        [this.tenantId, dataSourceId],
      );
      if (!source.rowCount)
        throw new WorkspaceRepositoryError('NOT_FOUND', '数据源不存在或已归档。');
      const run = await client.query(
        `INSERT INTO ${this.table('data_source_ingestion_runs')}
           (tenant_id, data_source_id, trigger_kind, status)
         VALUES ($1, $2, 'manual', 'running') RETURNING id`,
        [this.tenantId, dataSourceId],
      );
      const title = input.filename.replace(/\.[^.]+$/, '') || input.filename;
      const audio = await client.query(
        `INSERT INTO ${this.table('audio_files')}
           (tenant_id, data_source_id, ingestion_run_id, title, original_filename,
            mime_type, size_bytes, storage_key, upload_status, upload_progress,
            runtime_mode, storage_backend, storage_binding_revision_id,
            source_delete_after, transcript_selection_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploading', 0,
                 $9, $10, $11,
                 CASE WHEN $9 = 'object_storage' AND $12::integer IS NOT NULL
                      THEN now() + make_interval(days => $12::integer) ELSE NULL END,
                 'auto') RETURNING id`,
        [
          this.tenantId,
          dataSourceId,
          run.rows[0].id,
          title,
          input.filename,
          input.mimeType,
          input.sizeBytes,
          storage.key,
          settings.mode,
          storage.backend,
          storage.bindingRevisionId,
          settings.originalRetentionDays,
        ],
      );
      const session = await client.query(
        `INSERT INTO ${this.table('audio_upload_sessions')}
           (tenant_id, data_source_id, audio_file_id, runtime_mode, upload_strategy,
            original_filename, mime_type, size_bytes, storage_key,
            include_acoustic_emotion, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + interval '1 hour')
         RETURNING id, expires_at`,
        [
          this.tenantId,
          dataSourceId,
          audio.rows[0].id,
          settings.mode,
          storage.strategy,
          input.filename,
          input.mimeType,
          input.sizeBytes,
          storage.key,
          input.includeAcousticEmotion,
        ],
      );
      await client.query('COMMIT');
      return {
        id: String(session.rows[0].id),
        audioFileId: String(audio.rows[0].id),
        dataSourceId,
        mode: settings.mode,
        strategy: storage.strategy,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: storage.key,
        storageBindingRevisionId: storage.bindingRevisionId,
        includeAcousticEmotion: input.includeAcousticEmotion,
        status: 'created',
        expiresAt: new Date(session.rows[0].expires_at),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 读取会话及其资产固化的存储绑定。 */
  async get(id: string): Promise<StoredUploadSession> {
    const result = await this.pool.query(
      `SELECT session.*, af.storage_binding_revision_id
       FROM ${this.table('audio_upload_sessions')} session
       JOIN ${this.table('audio_files')} af
         ON af.tenant_id = session.tenant_id AND af.id = session.audio_file_id
       WHERE session.tenant_id = $1 AND session.id = $2`,
      [this.tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '上传会话不存在。');
    return {
      id: row.id,
      audioFileId: row.audio_file_id,
      dataSourceId: row.data_source_id,
      mode: row.runtime_mode,
      strategy: row.upload_strategy,
      filename: row.original_filename,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      storageKey: row.storage_key,
      storageBindingRevisionId: row.storage_binding_revision_id ?? null,
      includeAcousticEmotion: row.include_acoustic_emotion,
      status: row.status,
      expiresAt: new Date(row.expires_at),
    };
  }

  /** 标记 API 二进制已经完整写入。 */
  async markUploaded(id: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.table('audio_upload_sessions')}
       SET status = 'uploaded'
       WHERE tenant_id = $1 AND id = $2 AND status = 'created' AND expires_at > now()`,
      [this.tenantId, id],
    );
    if (!result.rowCount)
      throw new WorkspaceRepositoryError('CONFLICT', '上传会话已过期或状态不允许写入。');
  }

  /** 发布校验后的 AudioAsset 并完成 ingestion run。 */
  async complete(id: string, durationMs: number, sha256: string): Promise<void> {
    const result = await this.pool.query(
      `WITH completed AS (
         UPDATE ${this.table('audio_upload_sessions')}
         SET status = 'ready', completed_at = now()
         WHERE tenant_id = $1 AND id = $2
           AND status IN ('created', 'uploaded', 'validating') AND expires_at > now()
         RETURNING audio_file_id
       ), published AS (
         UPDATE ${this.table('audio_files')} af
         SET upload_status = 'ready', upload_progress = 100, duration_ms = $3,
             source_sha256 = $4, updated_at = now()
         FROM completed
         WHERE af.tenant_id = $1 AND af.id = completed.audio_file_id
         RETURNING af.ingestion_run_id
       )
       UPDATE ${this.table('data_source_ingestion_runs')} run
       SET status = 'succeeded', completed_at = now()
       FROM published
       WHERE run.tenant_id = $1 AND run.id = published.ingestion_run_id
       RETURNING run.id`,
      [this.tenantId, id, durationMs, sha256],
    );
    if (!result.rowCount) throw new WorkspaceRepositoryError('CONFLICT', '上传会话无法完成确认。');
  }

  /** 返回等待用户重新选择原文件的轻量资产指纹。 */
  async getRemountAsset(audioFileId: string): Promise<{
    originalFilename: string;
    sha256: string;
    sizeBytes: number;
    previousStorageKey: string | null;
  }> {
    const result = await this.pool.query(
      `SELECT original_filename, source_sha256, size_bytes, storage_key
       FROM ${this.table('audio_files')}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         AND runtime_mode = 'lightweight_local' AND source_recovery_state = 'required'
         AND source_sha256 IS NOT NULL`,
      [this.tenantId, audioFileId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new WorkspaceRepositoryError(
        'CONFLICT',
        '该音频当前不需要重新选择源文件，或缺少可校验的指纹。',
      );
    }
    return {
      originalFilename: row.original_filename,
      sha256: row.source_sha256,
      sizeBytes: Number(row.size_bytes),
      previousStorageKey: row.storage_key ?? null,
    };
  }

  /** 指纹校验成功后重新挂载临时源文件，但不隐式创建新的 ASR Run。 */
  async completeRemount(audioFileId: string, storageKey: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.table('audio_files')}
       SET storage_key = $3, source_state = 'available', source_recovery_state = 'not_required',
           cleanup_status = 'not_due', source_delete_after = NULL, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         AND runtime_mode = 'lightweight_local' AND source_recovery_state = 'required'`,
      [this.tenantId, audioFileId, storageKey],
    );
    if (!result.rowCount)
      throw new WorkspaceRepositoryError('CONFLICT', '源文件重新挂载状态已变化。');
  }
}
