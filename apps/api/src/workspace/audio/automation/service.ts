/**
 * 一键式音频分析应用服务。
 *
 * 在共享契约信任边界内创建批次，为新文件建立上传会话，并提供查询、恢复和取消操作。
 *
 * Responsibilities:
 * - 解析默认流水线选项并协调批次与上传会话创建。
 * - 为 HTTP 层提供不泄露内部数据库结构的稳定方法。
 */
import {
  AudioAnalysisBatchCreateRequestSchema,
  AudioAnalysisBatchCreateResponseSchema,
  AudioAnalysisCancelResponseSchema,
  AudioAnalysisResumeResponseSchema,
  type AudioAnalysisBatchCreateRequest,
} from '@echowave/contracts';

import type { AudioUploadSessionService } from '../runtime-mode/uploadSessionService.ts';
import type { AudioRuntimeService } from '../runtime-mode/service.ts';
import type { AudioAutomationRepository } from './repository.ts';
import { WorkspaceRepositoryError } from '../../errors.ts';
import type { SettingsService } from '../../../settings/service.ts';
import { SettingsError } from '../../../settings/types.ts';

/** 编排批次生命周期和新上传会话。 */
export class AudioAutomationService {
  constructor(
    private readonly repository: AudioAutomationRepository,
    private readonly uploads: AudioUploadSessionService,
    private readonly settings: Pick<SettingsService, 'resolveCapability'>,
    private readonly runtime?: Pick<AudioRuntimeService, 'availabilityForMode'>,
  ) {}

  /** 创建最多二十项的批次，并为上传来源返回逐文件上传目标。 */
  async create(rawInput: AudioAnalysisBatchCreateRequest) {
    const input = AudioAnalysisBatchCreateRequestSchema.parse(rawInput);
    const runtimeMode = await this.uploads.currentRuntimeMode();
    if (input.source === 'uploads' && this.runtime) {
      const availability = await this.runtime.availabilityForMode(runtimeMode);
      if (!availability.available) {
        throw new SettingsError('CONFIGURATION_REQUIRED', availability.unavailableReason!);
      }
    }
    if (
      input.source === 'uploads' &&
      input.scheduledFor &&
      new Date(input.scheduledFor).getTime() > Date.now() &&
      runtimeMode === 'lightweight_local'
    ) {
      throw new WorkspaceRepositoryError('CONFLICT', '轻量本地模式不支持定时分析。');
    }
    const capabilities = await this.capabilitySnapshot();
    const created = await this.repository.createBatch(input, capabilities, runtimeMode);
    const uploadTargets = [];
    if (input.source === 'uploads') {
      for (const item of input.items) {
        const task = created.tasks.find(
          (candidate) => candidate.clientItemId === item.clientItemId,
        )!;
        try {
          const session = await this.uploads.create(
            input.dataSourceId,
            { ...item, includeAcousticEmotion: input.pipeline.includeEmotion },
            task.id,
            runtimeMode,
          );
          uploadTargets.push({ clientItemId: item.clientItemId, taskId: task.id, session });
        } catch (error) {
          await this.repository.failUpload(
            task.id,
            error instanceof Error ? error.message : '上传会话创建失败。',
          );
          throw error;
        }
      }
    }
    return AudioAnalysisBatchCreateResponseSchema.parse({
      batch: await this.repository.getBatch(created.batchId),
      uploads: uploadTargets,
    });
  }

  private async capabilitySnapshot() {
    const names = [
      'audio_transcription',
      'audio_staging',
      'audio_emotion',
      'audio_role',
      'business_analysis',
      'knowledge_embedding',
    ] as const;
    const resolved = await Promise.all(
      names.map(async (name) => {
        try {
          return await this.settings.resolveCapability(name);
        } catch (error) {
          if (error instanceof SettingsError && error.code === 'CONFIGURATION_REQUIRED')
            return null;
          throw error;
        }
      }),
    );
    return {
      capabilityBindings: {
        transcription: resolved[0]?.revisionId ?? null,
        staging: resolved[1]?.revisionId ?? null,
        emotion: resolved[2]?.revisionId ?? null,
        role: resolved[3]?.revisionId ?? null,
        businessAnalysis: resolved[4]?.revisionId ?? null,
        knowledgeEmbedding: resolved[5]?.revisionId ?? null,
      },
      models: {
        transcription: resolved[0]?.model ?? null,
        emotion: resolved[2]?.model ?? null,
        role: resolved[3]?.model ?? null,
        businessAnalysis: resolved[4]?.model ?? null,
      },
    };
  }

  get(batchId: string) {
    return this.repository.getBatch(batchId);
  }

  list() {
    return this.repository.listBatches();
  }

  async resumeBatch(batchId: string) {
    await this.repository.refreshCapabilitySnapshot(batchId, await this.capabilitySnapshot());
    return AudioAnalysisResumeResponseSchema.parse({
      resumedTaskIds: await this.repository.resumeBatch(batchId),
    });
  }

  async resumeTask(taskId: string) {
    await this.repository.refreshCapabilitySnapshot(
      await this.repository.batchIdForTask(taskId),
      await this.capabilitySnapshot(),
    );
    return AudioAnalysisResumeResponseSchema.parse({
      resumedTaskIds: await this.repository.resumeTask(taskId),
    });
  }

  async cancelBatch(batchId: string) {
    return AudioAnalysisCancelResponseSchema.parse({
      canceledTaskIds: await this.repository.cancelBatch(batchId),
    });
  }

  async cancelTask(taskId: string) {
    return AudioAnalysisCancelResponseSchema.parse({
      canceledTaskIds: await this.repository.cancelTask(taskId),
    });
  }
}
