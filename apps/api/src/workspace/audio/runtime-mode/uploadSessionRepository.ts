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
import {
  AsrEnhancementSchema,
  type AudioRuntimeMode,
  type AudioUploadSessionCreateRequest,
  type AsrEnhancement,
} from '@echowave/contracts';

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
  postUploadAction: 'transcribe' | 'store_only';
  status: 'created' | 'uploaded' | 'validating' | 'ready' | 'failed' | 'expired';
  expiresAt: Date;
  analysisTaskId: string | null;
  asrEnhancement?: AsrEnhancement;
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

  /** 在读取当前模式前恢复原上传会话，参数或有效目标变化时拒绝重试。 */
  async findIdempotent(
    dataSourceId: string,
    input: AudioUploadSessionCreateRequest,
    analysisTaskId: string | null,
  ): Promise<StoredUploadSession | undefined> {
    const key = input.idempotencyKey ?? (analysisTaskId ? `analysis:${analysisTaskId}` : null);
    if (!key) return undefined;
    const result = await this.pool.query(
      `SELECT session.id, session.request_snapshot = $3::jsonb AS matches,
              source.deleted_at AS archived_at
       FROM ${this.table('audio_upload_sessions')} session
       JOIN ${this.table('data_sources')} source ON source.tenant_id = session.tenant_id AND source.id = session.data_source_id
       WHERE session.tenant_id = $1 AND session.idempotency_key = $2`,
      [this.tenantId, key, JSON.stringify({ ...input, dataSourceId, analysisTaskId })],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    if (!row.matches || row.archived_at)
      throw new WorkspaceRepositoryError('CONFLICT', '重复请求参数不一致或目标数据源已归档。');
    return this.get(String(row.id));
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
      backend: 'local_persistent' | 'local_ephemeral' | 'aliyun_oss';
      bindingRevisionId: string | null;
      key: string;
      strategy: StoredUploadSession['strategy'];
    },
    analysisTaskId: string | null = null,
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
      const requestKey =
        input.idempotencyKey ?? (analysisTaskId ? `analysis:${analysisTaskId}` : null);
      if (requestKey) {
        // 同租户请求先串行化，再检查参数，避免并发重试创建重复资产。
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${this.tenantId}:upload:${requestKey}`,
        ]);
        const existing = await client.query(
          `SELECT id, request_snapshot = $3::jsonb AS matches FROM ${this.table('audio_upload_sessions')}
           WHERE tenant_id = $1 AND idempotency_key = $2`,
          [this.tenantId, requestKey, JSON.stringify({ ...input, dataSourceId, analysisTaskId })],
        );
        if (existing.rows[0]) {
          if (!existing.rows[0].matches)
            throw new WorkspaceRepositoryError('CONFLICT', '重复请求的上传参数不一致。');
          await client.query('COMMIT');
          return await this.get(String(existing.rows[0].id), client);
        }
      }
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
            include_acoustic_emotion, expires_at, analysis_task_id, post_upload_action, idempotency_key, request_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + interval '1 hour', $11, $12, $13, $14::jsonb)
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
          analysisTaskId,
          input.postUploadAction,
          requestKey,
          JSON.stringify({ ...input, dataSourceId, analysisTaskId }),
        ],
      );
      if (analysisTaskId) {
        const attached = await client.query(
          `UPDATE ${this.table('audio_analysis_tasks')}
           SET audio_file_id = $3, runtime_mode = $4, updated_at = now()
           WHERE tenant_id = $1 AND id = $2 AND status = 'awaiting_upload'
             AND audio_file_id IS NULL`,
          [this.tenantId, analysisTaskId, audio.rows[0].id, settings.mode],
        );
        if (!attached.rowCount) {
          throw new WorkspaceRepositoryError('CONFLICT', '自动分析上传任务无法绑定音频。');
        }
      }
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
        postUploadAction: input.postUploadAction,
        status: 'created',
        expiresAt: new Date(session.rows[0].expires_at),
        analysisTaskId,
        asrEnhancement: input.asrEnhancement,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 读取会话及其资产固化的存储绑定。 */
  async get(
    id: string,
    client: Pick<DatabasePool, 'query'> = this.pool,
  ): Promise<StoredUploadSession> {
    const result = await client.query(
      `SELECT session.*, af.storage_binding_revision_id
       FROM ${this.table('audio_upload_sessions')} session
       JOIN ${this.table('audio_files')} af
         ON af.tenant_id = session.tenant_id AND af.id = session.audio_file_id
       WHERE session.tenant_id = $1 AND session.id = $2`,
      [this.tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '上传会话不存在。');
    const requestSnapshot =
      typeof row.request_snapshot === 'string'
        ? (() => {
            try {
              return JSON.parse(row.request_snapshot) as unknown;
            } catch {
              return undefined;
            }
          })()
        : row.request_snapshot;
    const parsedRequest =
      requestSnapshot && typeof requestSnapshot === 'object' && !Array.isArray(requestSnapshot)
        ? AsrEnhancementSchema.safeParse(
            (requestSnapshot as Record<string, unknown>).asrEnhancement,
          )
        : { success: false as const };
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
      postUploadAction: row.post_upload_action ?? 'transcribe',
      status: row.status,
      expiresAt: new Date(row.expires_at),
      analysisTaskId: row.analysis_task_id ?? null,
      asrEnhancement: parsedRequest.success ? parsedRequest.data : undefined,
    };
  }

  /** 延长尚未校验的同一会话，保留资产、模式、上传动作和对象定位键。 */
  async renewExpired(id: string): Promise<StoredUploadSession> {
    const renewed = await this.pool.query(
      `UPDATE ${this.table('audio_upload_sessions')}
       SET expires_at = now() + interval '1 hour'
       WHERE tenant_id = $1 AND id = $2 AND status IN ('created', 'uploaded')
         AND expires_at <= now()
       RETURNING id`,
      [this.tenantId, id],
    );
    if (!renewed.rowCount)
      throw new WorkspaceRepositoryError('CONFLICT', '上传会话无法续期，请重新导入原件。');
    return this.get(id);
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
         RETURNING af.ingestion_run_id, af.id
       ), released AS (
         UPDATE ${this.table('audio_analysis_tasks')} task
         SET status = CASE WHEN task.run_after IS NOT NULL AND task.run_after > now()
                           THEN 'scheduled' ELSE 'queued' END,
             phase = 'transcription', progress = 0, updated_at = now()
         FROM completed, published, ${this.table('audio_upload_sessions')} session
         WHERE session.tenant_id = $1 AND session.id = $2
           AND session.audio_file_id = published.id
           AND task.tenant_id = session.tenant_id
           AND task.id = session.analysis_task_id
           AND task.status = 'awaiting_upload'
         RETURNING task.id
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

  /** 上传校验永久失败时原子终止资产、自动任务并创建一次失败通知。 */
  async fail(id: string, message: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query(
        `SELECT audio_file_id, analysis_task_id
         FROM ${this.table('audio_upload_sessions')}
         WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [this.tenantId, id],
      );
      const row = session.rows[0];
      if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '上传会话不存在。');
      await client.query(
        `UPDATE ${this.table('audio_upload_sessions')}
         SET status = 'failed', error_code = 'UPLOAD_VALIDATION_FAILED', error_message = $3
         WHERE tenant_id = $1 AND id = $2 AND status <> 'ready'`,
        [this.tenantId, id, message.slice(0, 500)],
      );
      await client.query(
        `UPDATE ${this.table('audio_files')}
         SET upload_status = 'failed', error_code = 'UPLOAD_VALIDATION_FAILED',
             error_message = $3, error_retryable = true, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND upload_status <> 'ready'`,
        [this.tenantId, row.audio_file_id, message.slice(0, 500)],
      );
      if (row.analysis_task_id) {
        const failed = await client.query(
          `UPDATE ${this.table('audio_analysis_tasks')}
           SET status = 'failed', phase = 'done', error_code = 'UPLOAD_VALIDATION_FAILED',
               error_message = $3, error_retryable = true,
               completed_at = now(), updated_at = now()
           WHERE tenant_id = $1 AND id = $2 AND status = 'awaiting_upload'
           RETURNING batch_id`,
          [this.tenantId, row.analysis_task_id, message.slice(0, 500)],
        );
        if (failed.rows[0]) {
          const event = await client.query(
            `INSERT INTO ${this.table('notification_events')}
               (tenant_id, batch_id, task_id, event_type, dedupe_key, title, body)
             VALUES ($1, $2, $3, 'FAILED', $4, '音频上传校验失败', $5)
             ON CONFLICT (tenant_id, dedupe_key) DO NOTHING RETURNING id`,
            [
              this.tenantId,
              failed.rows[0].batch_id,
              row.analysis_task_id,
              `upload-failed:${row.analysis_task_id}`,
              message.slice(0, 500),
            ],
          );
          if (event.rows[0]) {
            await client.query(
              `INSERT INTO ${this.table('notification_deliveries')}
                 (tenant_id, event_id, device_id)
               SELECT $1, $2, id FROM ${this.table('push_devices')}
               WHERE tenant_id = $1 AND enabled = true ON CONFLICT DO NOTHING`,
              [this.tenantId, event.rows[0].id],
            );
          }
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE ${this.table('audio_files')}
         SET storage_key = $3, source_state = 'available', source_recovery_state = 'not_required',
             cleanup_status = 'pending', source_delete_after = now() + interval '24 hours', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
           AND runtime_mode = 'lightweight_local' AND source_recovery_state = 'required'`,
        [this.tenantId, audioFileId, storageKey],
      );
      if (!result.rowCount) {
        throw new WorkspaceRepositoryError('CONFLICT', '源文件重新挂载状态已变化。');
      }
      await client.query(
        `UPDATE ${this.table('audio_analysis_tasks')}
         SET status = 'queued', blocker_reason = NULL, blocker_capability = NULL,
             blocker_message = NULL, source_expires_at = NULL, updated_at = now()
         WHERE tenant_id = $1 AND audio_file_id = $2 AND status = 'hard_blocked'
           AND blocker_reason = 'SOURCE_REMOUNT_REQUIRED'`,
        [this.tenantId, audioFileId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
