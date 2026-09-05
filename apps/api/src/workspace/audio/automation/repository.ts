/**
 * 音频自动分析批次 PostgreSQL Repository。
 *
 * 保存批次配置快照、任务阶段指针和可恢复阻塞状态，并以 SKIP LOCKED 为编排器提供
 * 幂等领取入口。
 *
 * Responsibilities:
 * - 创建、读取、领取和推进自动分析任务。
 * - 聚合批次计数并保存阶段引用、警告、失败和通知事件。
 *
 * Notes:
 * - 具体模型调用仍由既有 ASR、后置分析和业务分析 Worker 执行。
 */
import {
  AudioAnalysisBatchListResponseSchema,
  AudioAnalysisBatchSchema,
  DEFAULT_GROUP_ANALYSIS_FOCUS,
  DEFAULT_GROUP_ANALYSIS_TONE,
  type AudioAnalysisBatch,
  type AudioAnalysisBatchCreateRequest,
  type AudioAnalysisBlockReason,
  type AudioAnalysisPipelineOptions,
  type AudioAnalysisTaskPhase,
  type AudioRuntimeMode,
} from '@echowave/contracts';
import type { PoolClient } from 'pg';

import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';
import { WorkspaceRepositoryError } from '../../errors.ts';

type ConfigurationSnapshot = AudioAnalysisBatch['configurationSnapshot'];

export type ClaimedAutomationTask = {
  id: string;
  batchId: string;
  audioFileId: string;
  groupId: string;
  runtimeMode: 'hybrid' | 'object_storage' | 'lightweight_local';
  phase: AudioAnalysisTaskPhase;
  pipeline: AudioAnalysisPipelineOptions;
  configuration: ConfigurationSnapshot;
  analysisRevisionId: string | null;
  emotionJobId: string | null;
  roleJobId: string | null;
  businessJobId: string | null;
  warningCodes: string[];
  cancelRequested: boolean;
};

export type ChildJobState = {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  errorRetryable: boolean;
  progress: number;
};

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** 管理固定租户下的自动分析批次和任务。 */
export class AudioAutomationRepository {
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

  /** 创建批次和初始任务，并冻结业务设置与知识库范围。 */
  async createBatch(
    input: AudioAnalysisBatchCreateRequest,
    capabilitySnapshot: Pick<ConfigurationSnapshot, 'capabilityBindings' | 'models'>,
    runtimeMode: AudioRuntimeMode,
  ): Promise<{
    batchId: string;
    tasks: { id: string; clientItemId: string | null; audioFileId: string | null }[];
  }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const context = await client.query(
        `SELECT ds.id AS data_source_id, g.id AS group_id, g.name AS group_name,
                coalesce(s.analysis_timing, 'manual') AS analysis_timing,
                coalesce(s.content_focus, $4) AS content_focus,
                coalesce(s.tone, $5) AS tone,
                coalesce(s.custom_tags, '[]'::jsonb) AS custom_tags,
                coalesce(array_agg(DISTINCT gkb.knowledge_base_id)
                  FILTER (WHERE gkb.knowledge_base_id IS NOT NULL), '{}') AS knowledge_base_ids
         FROM ${this.table('data_sources')} ds
         JOIN ${this.table('groups')} g
           ON g.tenant_id = ds.tenant_id AND g.id = $3 AND g.deleted_at IS NULL
         JOIN ${this.table('group_data_sources')} gds
           ON gds.tenant_id = ds.tenant_id AND gds.group_id = g.id
          AND gds.data_source_id = ds.id
         LEFT JOIN ${this.table('group_analysis_settings')} s
           ON s.tenant_id = g.tenant_id AND s.group_id = g.id
         LEFT JOIN ${this.table('group_knowledge_bases')} gkb
           ON gkb.tenant_id = g.tenant_id AND gkb.group_id = g.id
         WHERE ds.tenant_id = $1 AND ds.id = $2 AND ds.deleted_at IS NULL
         GROUP BY ds.id, g.id, g.name, s.analysis_timing,
                  s.content_focus, s.tone, s.custom_tags`,
        [
          this.tenantId,
          input.dataSourceId,
          input.groupId,
          DEFAULT_GROUP_ANALYSIS_FOCUS,
          DEFAULT_GROUP_ANALYSIS_TONE,
        ],
      );
      const row = context.rows[0];
      if (!row) {
        throw new WorkspaceRepositoryError('CONFLICT', '数据源未关联所选分组，或资源已归档。');
      }
      const configuration: ConfigurationSnapshot = {
        groupName: row.group_name,
        analysisTiming: row.analysis_timing,
        contentFocus: row.content_focus,
        tone: row.tone,
        customTags: strings(row.custom_tags),
        knowledgeBaseIds: strings(row.knowledge_base_ids),
        ...capabilitySnapshot,
      };
      const created = await client.query(
        `INSERT INTO ${this.table('audio_analysis_batches')}
           (tenant_id, data_source_id, group_id, source_kind, scheduled_for,
            pipeline_snapshot, configuration_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
         RETURNING id`,
        [
          this.tenantId,
          input.dataSourceId,
          input.groupId,
          input.source,
          input.scheduledFor,
          JSON.stringify(input.pipeline),
          JSON.stringify(configuration),
        ],
      );
      const batchId = String(created.rows[0].id);
      const tasks: { id: string; clientItemId: string | null; audioFileId: string | null }[] = [];
      if (input.source === 'uploads') {
        for (const item of input.items) {
          const task = await client.query(
            `INSERT INTO ${this.table('audio_analysis_tasks')}
               (tenant_id, batch_id, client_item_id, title, runtime_mode, status, phase, run_after)
             VALUES ($1, $2, $3, $4, $5, 'awaiting_upload', 'upload', $6)
             RETURNING id`,
            [
              this.tenantId,
              batchId,
              item.clientItemId,
              item.filename.replace(/\.[^.]+$/, '') || item.filename,
              runtimeMode,
              input.scheduledFor,
            ],
          );
          tasks.push({
            id: String(task.rows[0].id),
            clientItemId: item.clientItemId,
            audioFileId: null,
          });
        }
      } else {
        const assets = await client.query(
          `SELECT af.id, af.title, af.runtime_mode, af.source_state, af.source_recovery_state,
                  coalesce(latest.acoustic_emotion_ready, false) AS acoustic_emotion_ready
           FROM ${this.table('audio_files')} af
           LEFT JOIN LATERAL (
             SELECT CASE WHEN active_emotion.status = 'ready' OR bundled.status = 'ready'
                      THEN true ELSE false END AS acoustic_emotion_ready
             FROM ${this.table('audio_analysis_revisions')} ar
             LEFT JOIN ${this.table('audio_post_analysis_jobs')} bundled
               ON bundled.tenant_id = ar.tenant_id AND bundled.id = ar.bundled_emotion_job_id
             LEFT JOIN ${this.table('audio_post_analysis_jobs')} active_emotion
               ON active_emotion.tenant_id = ar.tenant_id
              AND active_emotion.id = ar.active_emotion_job_id
             WHERE ar.tenant_id = af.tenant_id AND ar.audio_file_id = af.id
             ORDER BY ar.revision_no DESC LIMIT 1
           ) latest ON true
           WHERE af.tenant_id = $1 AND af.data_source_id = $2 AND af.id = ANY($3::uuid[])
             AND af.deleted_at IS NULL AND af.upload_status = 'ready'
           ORDER BY af.created_at`,
          [this.tenantId, input.dataSourceId, input.audioFileIds],
        );
        if (assets.rowCount !== input.audioFileIds.length) {
          throw new WorkspaceRepositoryError(
            'NOT_FOUND',
            '部分音频不存在、未上传完成或不属于当前数据源。',
          );
        }
        const mismatched = assets.rows.filter((asset) => asset.runtime_mode !== runtimeMode);
        if (mismatched.length) {
          const details = mismatched
            .map((asset) => `${asset.id}(${asset.runtime_mode ?? 'unknown'})`)
            .join(', ');
          throw new WorkspaceRepositoryError(
            'CONFLICT',
            `所选音频运行模式与当前模式 ${runtimeMode} 不一致：${details}`,
          );
        }
        const lightweightIds = assets.rows
          .filter((asset) => asset.runtime_mode === 'lightweight_local')
          .map((asset) => String(asset.id));
        if (
          input.scheduledFor &&
          new Date(input.scheduledFor).getTime() > Date.now() &&
          lightweightIds.length
        ) {
          throw new WorkspaceRepositoryError(
            'CONFLICT',
            `轻量本地音频不能定时执行：${lightweightIds.join(', ')}`,
          );
        }
        if (runtimeMode === 'lightweight_local' && input.pipeline.includeEmotion) {
          const remountRequired = assets.rows
            .filter(
              (asset) =>
                asset.source_state !== 'available' && !Boolean(asset.acoustic_emotion_ready),
            )
            .map((asset) => String(asset.id));
          if (remountRequired.length) {
            throw new WorkspaceRepositoryError(
              'CONFLICT',
              `轻量本地音频缺少可复用的声学情绪结果，请先重新挂载原文件：${remountRequired.join(', ')}`,
            );
          }
        }
        for (const asset of assets.rows) {
          const scheduled =
            input.scheduledFor && new Date(input.scheduledFor).getTime() > Date.now();
          const task = await client.query(
            `INSERT INTO ${this.table('audio_analysis_tasks')}
               (tenant_id, batch_id, audio_file_id, title, runtime_mode, status, phase, run_after)
             VALUES ($1, $2, $3, $4, $5, $6, 'transcription', $7)
             RETURNING id`,
            [
              this.tenantId,
              batchId,
              asset.id,
              asset.title,
              runtimeMode,
              scheduled ? 'scheduled' : 'queued',
              input.scheduledFor,
            ],
          );
          tasks.push({
            id: String(task.rows[0].id),
            clientItemId: null,
            audioFileId: String(asset.id),
          });
        }
      }
      await client.query('COMMIT');
      return { batchId, tasks };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 把上传会话创建出的资产绑定到等待上传任务。 */
  async attachUpload(taskId: string, audioFileId: string, runtimeMode: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.table('audio_analysis_tasks')}
       SET audio_file_id = $3, runtime_mode = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'awaiting_upload' AND audio_file_id IS NULL`,
      [this.tenantId, taskId, audioFileId, runtimeMode],
    );
    if (!result.rowCount)
      throw new WorkspaceRepositoryError('CONFLICT', '自动分析上传任务无法绑定音频。');
  }

  /** 上传校验完成后按计划时间释放任务。 */
  async markUploadReady(taskId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.table('audio_analysis_tasks')}
       SET status = CASE WHEN run_after IS NOT NULL AND run_after > now() THEN 'scheduled' ELSE 'queued' END,
           phase = 'transcription', progress = 0, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'awaiting_upload' AND audio_file_id IS NOT NULL`,
      [this.tenantId, taskId],
    );
    if (!result.rowCount) throw new WorkspaceRepositoryError('CONFLICT', '上传任务尚未准备完成。');
  }

  /** 上传失败时终止该项，但不影响同批其他文件。 */
  async failUpload(taskId: string, message: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_tasks')}
       SET status = 'failed', phase = 'done', error_code = 'UPLOAD_FAILED',
           error_message = $3, error_retryable = true, completed_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'awaiting_upload'`,
      [this.tenantId, taskId, message.slice(0, 500)],
    );
  }

  /** 读取一个批次及聚合后的任务计数。 */
  async getBatch(batchId: string): Promise<AudioAnalysisBatch> {
    const batch = await this.pool.query(
      `SELECT * FROM ${this.table('audio_analysis_batches')}
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, batchId],
    );
    if (!batch.rows[0]) throw new WorkspaceRepositoryError('NOT_FOUND', '分析批次不存在。');
    const tasks = await this.pool.query(
      `SELECT task.*, business.status AS business_status,
              business.group_id AS business_group_id,
              business.audio_file_id AS business_audio_file_id,
              business_head.active_job_id AS business_head_job_id
       FROM ${this.table('audio_analysis_tasks')} task
       LEFT JOIN ${this.table('audio_business_analysis_jobs')} business
         ON business.tenant_id = task.tenant_id AND business.id = task.business_job_id
        AND business.group_id = $3 AND business.audio_file_id = task.audio_file_id
       LEFT JOIN ${this.table('audio_group_business_analysis_heads')} business_head
         ON business_head.tenant_id = task.tenant_id
        AND business_head.group_id = $3
        AND business_head.audio_file_id = task.audio_file_id
       WHERE task.tenant_id = $1 AND task.batch_id = $2 ORDER BY task.created_at, task.id`,
      [this.tenantId, batchId, batch.rows[0].group_id],
    );
    const mapped = tasks.rows.map((row) => {
      // 报告只能指向本次任务发布的业务任务，不能复用失败/取消任务的旧 head。
      const reportAvailable =
        (row.status === 'completed' || row.status === 'completed_with_warnings') &&
        Boolean(row.audio_file_id) &&
        Boolean(row.business_job_id) &&
        row.business_status === 'ready' &&
        row.business_group_id === batch.rows[0].group_id &&
        row.business_audio_file_id === row.audio_file_id &&
        row.business_head_job_id === row.business_job_id;
      return {
        id: row.id,
        batchId: row.batch_id,
        audioFileId: row.audio_file_id ?? null,
        title: row.title,
        runtimeMode: row.runtime_mode ?? null,
        status: row.status,
        phase: row.phase,
        progress: Number(row.progress),
        runAfter: iso(row.run_after),
        warningCodes: strings(row.warning_codes),
        blocker: row.blocker_reason
          ? {
              reason: row.blocker_reason,
              capability: row.blocker_capability,
              message: row.blocker_message,
              sourceExpiresAt: iso(row.source_expires_at),
            }
          : null,
        error: row.error_code
          ? {
              code: row.error_code,
              message: row.error_message,
              retryable: Boolean(row.error_retryable),
            }
          : null,
        report: reportAvailable
          ? { audioFileId: row.audio_file_id, groupId: batch.rows[0].group_id }
          : null,
        reportAvailable,
        createdAt: iso(row.created_at)!,
        updatedAt: iso(row.updated_at)!,
      };
    });
    const completed = mapped.filter((item) => item.status === 'completed').length;
    const partial = mapped.filter((item) => item.status === 'completed_with_warnings').length;
    const failed = mapped.filter((item) => item.status === 'failed').length;
    const canceled = mapped.filter((item) => item.status === 'canceled').length;
    const blocked = mapped.filter((item) => item.status === 'hard_blocked').length;
    const active = mapped.filter((item) =>
      ['scheduled', 'queued', 'running', 'awaiting_upload'].includes(item.status),
    ).length;
    const row = batch.rows[0];
    return AudioAnalysisBatchSchema.parse({
      id: row.id,
      dataSourceId: row.data_source_id,
      groupId: row.group_id,
      source: row.source_kind,
      scheduledFor: iso(row.scheduled_for),
      configurationSnapshot: row.configuration_snapshot,
      counts: { total: mapped.length, active, blocked, completed, partial, failed, canceled },
      tasks: mapped,
      createdAt: iso(row.created_at),
    });
  }

  /** 列出最近批次；首版数据量有界，后续再引入游标分页。 */
  async listBatches() {
    const result = await this.pool.query(
      `SELECT id FROM ${this.table('audio_analysis_batches')}
       WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [this.tenantId],
    );
    const items = await Promise.all(result.rows.map((row) => this.getBatch(String(row.id))));
    return AudioAnalysisBatchListResponseSchema.parse({ items });
  }

  /** 领取一条已到期或正在等待子任务收敛的流水线任务。 */
  async claim(): Promise<ClaimedAutomationTask | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT task.id FROM ${this.table('audio_analysis_tasks')} task
         JOIN ${this.table('audio_analysis_batches')} batch
           ON batch.tenant_id = task.tenant_id AND batch.id = task.batch_id
         WHERE task.tenant_id = $1 AND task.status IN ('scheduled', 'queued', 'running')
           AND (task.run_after IS NULL OR task.run_after <= now())
           AND batch.canceled_at IS NULL
         ORDER BY task.updated_at, task.created_at
         FOR UPDATE OF task SKIP LOCKED LIMIT 1
       )
       UPDATE ${this.table('audio_analysis_tasks')} task
       SET status = 'running', updated_at = now()
       FROM candidate, ${this.table('audio_analysis_batches')} batch
       WHERE task.tenant_id = $1 AND task.id = candidate.id
         AND batch.tenant_id = task.tenant_id AND batch.id = task.batch_id
       RETURNING task.*, batch.group_id, batch.pipeline_snapshot, batch.configuration_snapshot`,
      [this.tenantId],
    );
    const row = result.rows[0];
    if (!row || !row.audio_file_id || !row.runtime_mode) return undefined;
    return {
      id: row.id,
      batchId: row.batch_id,
      audioFileId: row.audio_file_id,
      groupId: row.group_id,
      runtimeMode: row.runtime_mode,
      phase: row.phase,
      pipeline: row.pipeline_snapshot,
      configuration: row.configuration_snapshot,
      analysisRevisionId: row.analysis_revision_id ?? null,
      emotionJobId: row.emotion_job_id ?? null,
      roleJobId: row.role_job_id ?? null,
      businessJobId: row.business_job_id ?? null,
      warningCodes: strings(row.warning_codes),
      cancelRequested: Boolean(row.cancel_requested),
    };
  }

  async reusableRevision(audioFileId: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT ar.id FROM ${this.table('audio_files')} af
       JOIN ${this.table('audio_analysis_revisions')} ar
         ON ar.tenant_id = af.tenant_id AND ar.audio_file_id = af.id
       WHERE af.tenant_id = $1 AND af.id = $2 AND af.deleted_at IS NULL
         AND ar.status IN ('queued', 'transcribing', 'analyzing', 'ready')
       ORDER BY (ar.id = af.active_analysis_revision_id) DESC, ar.created_at DESC
       LIMIT 1`,
      [this.tenantId, audioFileId],
    );
    return result.rows[0]?.id ?? null;
  }

  async setStageReference(
    taskId: string,
    input: {
      phase?: AudioAnalysisTaskPhase;
      analysisRevisionId?: string;
      emotionJobId?: string;
      roleJobId?: string;
      businessJobId?: string;
      progress?: number;
    },
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.table('audio_analysis_tasks')}
       SET phase = coalesce($3, phase), analysis_revision_id = coalesce($4, analysis_revision_id),
           emotion_job_id = coalesce($5, emotion_job_id), role_job_id = coalesce($6, role_job_id),
           business_job_id = coalesce($7, business_job_id), progress = coalesce($8, progress),
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
      [
        this.tenantId,
        taskId,
        input.phase ?? null,
        input.analysisRevisionId ?? null,
        input.emotionJobId ?? null,
        input.roleJobId ?? null,
        input.businessJobId ?? null,
        input.progress ?? null,
      ],
    );
    return result.rowCount === 1;
  }

  /** 父任务取消后清理尚未成功挂载到任务行的孤儿业务子任务。 */
  async cancelBusinessJob(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_business_analysis_jobs')}
       SET status = 'failed', error_code = 'CANCELED', error_message = '业务分析已取消。',
           error_retryable = false, completed_at = coalesce(completed_at, now()),
           next_attempt_at = NULL, checkpoint_cleanup_pending = true
       WHERE tenant_id = $1 AND id = $2 AND status = 'queued'`,
      [this.tenantId, jobId],
    );
    await this.pool.query(
      `UPDATE ${this.table('audio_business_analysis_jobs')}
       SET cancel_requested = true
       WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
      [this.tenantId, jobId],
    );
  }

  /** 父任务取消后清理尚未成功挂载到任务行的孤儿后置分析子任务。 */
  async cancelPostAnalysisJob(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_post_analysis_jobs')}
       SET status = 'failed', error_code = 'CANCELED', error_message = '后置分析已取消。',
           error_retryable = false, completed_at = coalesce(completed_at, now())
       WHERE tenant_id = $1 AND id = $2 AND status = 'queued'`,
      [this.tenantId, jobId],
    );
    await this.pool.query(
      `UPDATE ${this.table('audio_post_analysis_jobs')}
       SET cancel_requested = true
       WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
      [this.tenantId, jobId],
    );
  }

  async transcriptionState(revisionId: string): Promise<ChildJobState> {
    return this.childState('audio_analysis_revisions', revisionId);
  }

  async postAnalysisState(jobId: string): Promise<ChildJobState> {
    return this.childState('audio_post_analysis_jobs', jobId);
  }

  /** 查找当前修订已经发布或随轻量 ASR 创建的后置任务，避免重复调用供应商。 */
  async postAnalysisReferences(revisionId: string): Promise<{
    emotionJobId: string | null;
    roleJobId: string | null;
  }> {
    const result = await this.pool.query(
      `SELECT coalesce(
                revision.active_emotion_job_id,
                revision.bundled_emotion_job_id,
                (SELECT job.id FROM ${this.table('audio_post_analysis_jobs')} job
                 WHERE job.tenant_id = revision.tenant_id
                   AND job.analysis_revision_id = revision.id
                   AND job.analysis_type = 'emotion'
                   AND job.status IN ('queued', 'running', 'ready')
                 ORDER BY job.created_at DESC LIMIT 1)
              ) AS emotion_job_id,
              coalesce(
                revision.active_role_job_id,
                (SELECT job.id FROM ${this.table('audio_post_analysis_jobs')} job
                 WHERE job.tenant_id = revision.tenant_id
                   AND job.analysis_revision_id = revision.id
                   AND job.analysis_type = 'role'
                   AND job.status IN ('queued', 'running', 'ready')
                 ORDER BY job.created_at DESC LIMIT 1)
              ) AS role_job_id
       FROM ${this.table('audio_analysis_revisions')} revision
       WHERE revision.tenant_id = $1 AND revision.id = $2`,
      [this.tenantId, revisionId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '自动分析修订不存在。');
    return {
      emotionJobId: row.emotion_job_id ?? null,
      roleJobId: row.role_job_id ?? null,
    };
  }

  /** 读取非阻塞 Speaker Review 状态和疑点数量。 */
  async speakerReviewState(revisionId: string): Promise<{
    status: string | null;
    findingCount: number;
  }> {
    const result = await this.pool.query(
      `SELECT job.status,
              (SELECT count(*)::int FROM ${this.table('speaker_review_findings')} finding
               WHERE finding.tenant_id = $1 AND finding.analysis_revision_id = $2) AS finding_count
       FROM (SELECT 1) seed
       LEFT JOIN ${this.table('audio_speaker_review_jobs')} job
         ON job.tenant_id = $1 AND job.analysis_revision_id = $2`,
      [this.tenantId, revisionId],
    );
    return {
      status: result.rows[0]?.status ?? null,
      findingCount: Number(result.rows[0]?.finding_count ?? 0),
    };
  }

  /** 将可选阶段的永久失败记录为限制，供最终部分完成状态与业务报告使用。 */
  async addWarning(taskId: string, code: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_tasks')}
       SET warning_codes = CASE WHEN warning_codes ? $3 THEN warning_codes
                                ELSE warning_codes || to_jsonb($3::text) END,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
      [this.tenantId, taskId, code],
    );
  }

  /** 把自动流水线限制写入已创建的业务任务输入，确保最终报告能够披露缺失能力。 */
  async setBusinessLimitations(jobId: string, limitations: string[]): Promise<void> {
    if (!limitations.length) return;
    await this.pool.query(
      `UPDATE ${this.table('audio_business_analysis_jobs')}
       SET limitations = $3::jsonb
       WHERE tenant_id = $1 AND id = $2 AND status IN ('queued', 'running')`,
      [this.tenantId, jobId, JSON.stringify([...new Set(limitations)])],
    );
  }

  async businessState(jobId: string): Promise<ChildJobState> {
    return this.childState('audio_business_analysis_jobs', jobId);
  }

  private async childState(table: string, id: string): Promise<ChildJobState> {
    const result = await this.pool.query(
      `SELECT status, error_code, error_message, error_retryable, progress
       FROM ${this.table(table)} WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceRepositoryError('NOT_FOUND', '自动分析子任务不存在。');
    return {
      status: row.status,
      errorCode: row.error_code ?? null,
      errorMessage: row.error_message ?? null,
      errorRetryable: Boolean(row.error_retryable),
      progress: Number(row.progress),
    };
  }

  /** 完成任务并原子生成一次批次终态通知事件。 */
  async complete(task: ClaimedAutomationTask, warnings: string[]): Promise<void> {
    const status = warnings.length ? 'completed_with_warnings' : 'completed';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ${this.table('audio_analysis_tasks')}
         SET status = $3, phase = 'done', progress = 100, warning_codes = $4::jsonb,
             completed_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
        [this.tenantId, task.id, status, JSON.stringify([...new Set(warnings)])],
      );
      await this.createTerminalEventIfBatchFinished(client, task.batchId);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(
    task: ClaimedAutomationTask,
    code: string,
    message: string,
    retryable: boolean,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ${this.table('audio_analysis_tasks')}
         SET status = 'failed', phase = 'done', error_code = $3, error_message = $4,
             error_retryable = $5, completed_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
        [this.tenantId, task.id, code, message.slice(0, 500), retryable],
      );
      await this.createTerminalEventIfBatchFinished(client, task.batchId);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async block(
    task: ClaimedAutomationTask,
    reason: AudioAnalysisBlockReason,
    capability: string,
    message: string,
  ): Promise<void> {
    const sourceExpiresAt =
      task.runtimeMode === 'lightweight_local' && task.phase !== 'business_analysis'
        ? new Date(Date.now() + 24 * 60 * 60 * 1_000)
        : null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ${this.table('audio_analysis_tasks')}
         SET status = 'hard_blocked', blocker_reason = $3, blocker_capability = $4,
             blocker_message = $5, source_expires_at = $6, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
        [this.tenantId, task.id, reason, capability, message.slice(0, 500), sourceExpiresAt],
      );
      if (sourceExpiresAt) {
        await client.query(
          `UPDATE ${this.table('audio_files')}
           SET source_delete_after = $3, updated_at = now()
           WHERE tenant_id = $1 AND id = $2 AND runtime_mode = 'lightweight_local'
             AND source_state = 'available'`,
          [this.tenantId, task.audioFileId, sourceExpiresAt],
        );
      }
      await client.query(
        `INSERT INTO ${this.table('audio_analysis_batch_blockers')}
           (tenant_id, batch_id, capability, reason, message)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, batch_id, capability, reason) WHERE active = true DO NOTHING`,
        [this.tenantId, task.batchId, capability, reason, message.slice(0, 500)],
      );
      await client.query(
        `UPDATE ${this.table('audio_analysis_tasks')}
         SET status = 'hard_blocked', blocker_reason = $3, blocker_capability = $4,
             blocker_message = $5,
             source_expires_at = CASE
               WHEN runtime_mode = 'lightweight_local' AND phase <> 'business_analysis'
               THEN now() + interval '24 hours' ELSE source_expires_at END,
             updated_at = now()
         WHERE tenant_id = $1 AND batch_id = $2 AND status IN ('scheduled', 'queued')`,
        [this.tenantId, task.batchId, reason, capability, message.slice(0, 500)],
      );
      await client.query(
        `UPDATE ${this.table('audio_files')} af
         SET source_delete_after = greatest(
               coalesce(af.source_delete_after, '-infinity'::timestamptz),
               task.source_expires_at
             ), updated_at = now()
         FROM ${this.table('audio_analysis_tasks')} task
         WHERE task.tenant_id = $1 AND task.batch_id = $2
           AND task.audio_file_id = af.id AND task.source_expires_at IS NOT NULL
           AND af.tenant_id = task.tenant_id AND af.runtime_mode = 'lightweight_local'
           AND af.source_state = 'available'`,
        [this.tenantId, task.batchId],
      );
      await this.insertNotificationEvent(
        client,
        task.batchId,
        task.id,
        'HARD_BLOCKED',
        `blocked:${task.batchId}:${capability}:${reason}`,
        '分析任务需要处理',
        message,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resumeBatch(batchId: string): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ${this.table('audio_analysis_batch_blockers')}
         SET active = false, resolved_at = now()
         WHERE tenant_id = $1 AND batch_id = $2 AND active = true`,
        [this.tenantId, batchId],
      );
      await client.query(
        `UPDATE ${this.table('audio_analysis_tasks')} task
         SET blocker_reason = 'SOURCE_REMOUNT_REQUIRED', blocker_capability = 'source_audio',
             blocker_message = '轻量本地源文件已过期，请重新选择原文件后继续。', updated_at = now()
         WHERE task.tenant_id = $1 AND task.batch_id = $2 AND task.status = 'hard_blocked'
           AND task.runtime_mode = 'lightweight_local' AND task.phase <> 'business_analysis'
           AND EXISTS (
             SELECT 1 FROM ${this.table('audio_files')} af
             WHERE af.tenant_id = task.tenant_id AND af.id = task.audio_file_id
               AND af.source_state <> 'available'
           )`,
        [this.tenantId, batchId],
      );
      const resumed = await client.query(
        `UPDATE ${this.table('audio_analysis_tasks')} task
         SET status = 'queued', blocker_reason = NULL, blocker_capability = NULL,
             blocker_message = NULL, error_code = NULL, error_message = NULL,
             error_retryable = NULL, updated_at = now()
         WHERE task.tenant_id = $1 AND task.batch_id = $2 AND task.status = 'hard_blocked'
           AND task.blocker_reason <> 'SOURCE_REMOUNT_REQUIRED'
           AND (task.runtime_mode <> 'lightweight_local' OR task.phase = 'business_analysis' OR EXISTS (
             SELECT 1 FROM ${this.table('audio_files')} af
             WHERE af.tenant_id = task.tenant_id
               AND af.id = task.audio_file_id
               AND af.source_state = 'available'
           ))
         RETURNING id`,
        [this.tenantId, batchId],
      );
      await client.query('COMMIT');
      return resumed.rows.map((row) => String(row.id));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 恢复前只刷新能力 revision 与模型；分组设置和知识库快照保持入队值不变。 */
  async refreshCapabilitySnapshot(
    batchId: string,
    snapshot: Pick<ConfigurationSnapshot, 'capabilityBindings' | 'models'>,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_batches')}
       SET configuration_snapshot = jsonb_set(
             jsonb_set(configuration_snapshot, '{capabilityBindings}', $3::jsonb, true),
             '{models}', $4::jsonb, true
           ), updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [
        this.tenantId,
        batchId,
        JSON.stringify(snapshot.capabilityBindings),
        JSON.stringify(snapshot.models),
      ],
    );
  }

  async batchIdForTask(taskId: string): Promise<string> {
    const result = await this.pool.query(
      `SELECT batch_id FROM ${this.table('audio_analysis_tasks')}
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, taskId],
    );
    if (!result.rows[0]) throw new WorkspaceRepositoryError('NOT_FOUND', '自动分析任务不存在。');
    return String(result.rows[0].batch_id);
  }

  async resumeTask(taskId: string): Promise<string[]> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_tasks')} task
       SET blocker_reason = 'SOURCE_REMOUNT_REQUIRED', blocker_capability = 'source_audio',
           blocker_message = '轻量本地源文件已过期，请重新选择原文件后继续。', updated_at = now()
       WHERE task.tenant_id = $1 AND task.id = $2 AND task.status = 'hard_blocked'
         AND task.runtime_mode = 'lightweight_local' AND task.phase <> 'business_analysis'
         AND EXISTS (
           SELECT 1 FROM ${this.table('audio_files')} af
           WHERE af.tenant_id = task.tenant_id AND af.id = task.audio_file_id
             AND af.source_state <> 'available'
         )`,
      [this.tenantId, taskId],
    );
    const resumed = await this.pool.query(
      `UPDATE ${this.table('audio_analysis_tasks')} task
       SET status = 'queued', blocker_reason = NULL, blocker_capability = NULL,
           blocker_message = NULL, error_code = NULL, error_message = NULL,
           error_retryable = NULL, updated_at = now()
       WHERE task.tenant_id = $1 AND task.id = $2 AND task.status = 'hard_blocked'
         AND task.blocker_reason <> 'SOURCE_REMOUNT_REQUIRED'
         AND (task.runtime_mode <> 'lightweight_local' OR task.phase = 'business_analysis' OR EXISTS (
           SELECT 1 FROM ${this.table('audio_files')} af
           WHERE af.tenant_id = task.tenant_id
             AND af.id = task.audio_file_id
             AND af.source_state = 'available'
         ))
       RETURNING id`,
      [this.tenantId, taskId],
    );
    return resumed.rows.map((row) => String(row.id));
  }

  async cancelBatch(batchId: string): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ${this.table('audio_analysis_batches')}
         SET canceled_at = coalesce(canceled_at, now()), updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, batchId],
      );
      const canceled = await client.query(
        `UPDATE ${this.table('audio_analysis_tasks')}
         SET status = 'canceled', phase = 'done', completed_at = coalesce(completed_at, now()),
             updated_at = now()
         WHERE tenant_id = $1 AND batch_id = $2
           AND status IN ('awaiting_upload', 'scheduled', 'queued', 'hard_blocked')
         RETURNING id`,
        [this.tenantId, batchId],
      );
      await client.query(
        `UPDATE ${this.table('audio_analysis_tasks')}
         SET cancel_requested = true, updated_at = now()
         WHERE tenant_id = $1 AND batch_id = $2 AND status = 'running'`,
        [this.tenantId, batchId],
      );
      await this.propagateCancellation(client, batchId);
      await client.query('COMMIT');
      return canceled.rows.map((row) => String(row.id));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelTask(taskId: string): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const canceled = await client.query(
        `UPDATE ${this.table('audio_analysis_tasks')}
         SET status = 'canceled', phase = 'done', completed_at = coalesce(completed_at, now()),
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2
           AND status IN ('awaiting_upload', 'scheduled', 'queued', 'hard_blocked')
         RETURNING id, batch_id`,
        [this.tenantId, taskId],
      );
      await client.query(
        `UPDATE ${this.table('audio_analysis_tasks')}
         SET cancel_requested = true, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
        [this.tenantId, taskId],
      );
      const batch = await client.query(
        `SELECT batch_id FROM ${this.table('audio_analysis_tasks')}
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, taskId],
      );
      if (batch.rows[0])
        await this.propagateCancellation(client, String(batch.rows[0].batch_id), taskId);
      await client.query('COMMIT');
      return canceled.rows.map((row) => String(row.id));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 在父任务取消的同一事务内终止或标记所有已创建的阶段子任务。 */
  private async propagateCancellation(
    client: PoolClient,
    batchId: string,
    taskId?: string,
  ): Promise<void> {
    const taskFilter = taskId ? 'task.id = $2' : 'task.batch_id = $2';
    await client.query(
      `UPDATE ${this.table('audio_business_analysis_jobs')} job
       SET status = 'failed', error_code = 'CANCELED', error_message = '业务分析已取消。',
           error_retryable = false, completed_at = coalesce(completed_at, now()),
           next_attempt_at = NULL, checkpoint_cleanup_pending = true
       WHERE job.tenant_id = $1 AND job.status = 'queued'
         AND EXISTS (
           SELECT 1 FROM ${this.table('audio_analysis_tasks')} task
           WHERE task.tenant_id = job.tenant_id AND ${taskFilter}
             AND task.business_job_id = job.id
         )`,
      [this.tenantId, taskId ?? batchId],
    );
    await client.query(
      `UPDATE ${this.table('audio_business_analysis_jobs')} job
       SET cancel_requested = true
       WHERE job.tenant_id = $1 AND job.status = 'running'
         AND EXISTS (
           SELECT 1 FROM ${this.table('audio_analysis_tasks')} task
           WHERE task.tenant_id = job.tenant_id AND ${taskFilter}
             AND task.business_job_id = job.id
         )`,
      [this.tenantId, taskId ?? batchId],
    );
    await client.query(
      `UPDATE ${this.table('audio_post_analysis_jobs')} job
       SET status = 'failed', error_code = 'CANCELED', error_message = '后置分析已取消。',
           error_retryable = false, completed_at = coalesce(completed_at, now())
       WHERE job.tenant_id = $1 AND job.status = 'queued'
         AND EXISTS (
           SELECT 1 FROM ${this.table('audio_analysis_tasks')} task
           WHERE task.tenant_id = job.tenant_id AND ${taskFilter}
             AND (task.emotion_job_id = job.id OR task.role_job_id = job.id)
         )`,
      [this.tenantId, taskId ?? batchId],
    );
    await client.query(
      `UPDATE ${this.table('audio_post_analysis_jobs')} job
       SET cancel_requested = true
       WHERE job.tenant_id = $1 AND job.status = 'running'
         AND EXISTS (
           SELECT 1 FROM ${this.table('audio_analysis_tasks')} task
           WHERE task.tenant_id = job.tenant_id AND ${taskFilter}
             AND (task.emotion_job_id = job.id OR task.role_job_id = job.id)
         )`,
      [this.tenantId, taskId ?? batchId],
    );
  }

  async cancelAfterCurrent(task: ClaimedAutomationTask): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('audio_analysis_tasks')}
       SET status = 'canceled', phase = 'done', completed_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
      [this.tenantId, task.id],
    );
  }

  private async createTerminalEventIfBatchFinished(
    client: PoolClient,
    batchId: string,
  ): Promise<void> {
    const summary = await client.query(
      `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status IN ('completed', 'completed_with_warnings'))::int AS completed,
                count(*) FILTER (WHERE status = 'completed_with_warnings')::int AS partial,
                count(*) FILTER (WHERE status = 'failed')::int AS failed,
                count(*) FILTER (WHERE status NOT IN ('completed', 'completed_with_warnings', 'failed', 'canceled'))::int AS active
         FROM ${this.table('audio_analysis_tasks')}
         WHERE tenant_id = $1 AND batch_id = $2`,
      [this.tenantId, batchId],
    );
    const row = summary.rows[0];
    if (Number(row.active) === 0) {
      const eventType =
        Number(row.failed) > 0
          ? 'FAILED'
          : Number(row.partial) > 0
            ? 'PARTIAL_COMPLETED'
            : 'COMPLETED';
      const title =
        eventType === 'COMPLETED'
          ? '分析批次已完成'
          : eventType === 'PARTIAL_COMPLETED'
            ? '分析批次部分完成'
            : '分析批次存在失败';
      const body = `共 ${row.total} 项，完成 ${row.completed} 项，失败 ${row.failed} 项。`;
      await this.insertNotificationEvent(
        client,
        batchId,
        null,
        eventType,
        `terminal:${batchId}:${eventType}`,
        title,
        body,
      );
    }
  }

  private async insertNotificationEvent(
    client: PoolClient,
    batchId: string,
    taskId: string | null,
    eventType: string,
    dedupeKey: string,
    title: string,
    body: string,
  ): Promise<void> {
    const created = await client.query(
      `INSERT INTO ${this.table('notification_events')}
         (tenant_id, batch_id, task_id, event_type, dedupe_key, title, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING RETURNING id`,
      [this.tenantId, batchId, taskId, eventType, dedupeKey, title, body],
    );
    if (!created.rows[0]) return;
    await client.query(
      `INSERT INTO ${this.table('notification_deliveries')}
         (tenant_id, event_id, device_id)
       SELECT $1, $2, id FROM ${this.table('push_devices')}
       WHERE tenant_id = $1 AND enabled = true
       ON CONFLICT DO NOTHING`,
      [this.tenantId, created.rows[0].id],
    );
  }
}
