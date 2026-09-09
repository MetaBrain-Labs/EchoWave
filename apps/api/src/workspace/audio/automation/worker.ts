/**
 * 一键式音频全流程编排 Worker。
 *
 * 从 PostgreSQL 权威任务表领取到期任务，将每个阶段委托给既有可恢复 Worker，并仅保存
 * 阶段引用与业务状态；进程重启不会重复已经创建或完成的子任务。
 *
 * Responsibilities:
 * - 推进 ASR、系统 Raw 快照、情绪与角色、业务分析状态机。
 * - 处理可选阶段警告、硬阻塞、取消请求和十五秒补偿扫描。
 *
 * Notes:
 * - 供应商调用的网络退避与阶段 checkpoint 仍由对应子 Worker 负责。
 */
import type { AudioService } from '../core/service.ts';
import {
  noOpAiExecutionReporter,
  type AiExecutionReporter,
} from '../../../ai-observability/executionReporter.ts';
import type { WorkerWakeupSource } from '../../../infrastructure/workerWakeup.ts';
import { classifyHardBlock, classifyStoredHardBlock } from './errorClassification.ts';
import {
  AudioAutomationRepository,
  type AutomationStageSources,
  type ChildJobState,
  type ClaimedAutomationTask,
  type AutomationTerminalEventType,
} from './repository.ts';

const SAFETY_SCAN_MS = 15_000;

type AutomationWorkerOptions = {
  repository: AudioAutomationRepository;
  audio: AudioService;
  wakeup?: WorkerWakeupSource;
  reporter?: AiExecutionReporter;
};

function terminal(state: ChildJobState): boolean {
  return state.status === 'ready' || state.status === 'failed';
}

/** 以单执行器推进自动批次，避免本地轻量文件被同进程并发消费。 */
export class AudioAutomationWorker {
  private active?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private unsubscribeWakeup?: () => void;
  private stopping = false;

  constructor(private readonly options: AutomationWorkerOptions) {}

  /** 启动 LISTEN/NOTIFY 订阅与十五秒补偿扫描。 */
  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    this.unsubscribeWakeup = this.options.wakeup?.subscribe(
      'audio-analysis-automation',
      () => void this.pump(),
    );
    this.timer = setInterval(() => void this.pump(), SAFETY_SCAN_MS);
    this.timer.unref();
    void this.pump();
  }

  /** 停止领取新任务并等待当前一次状态推进安全结束。 */
  async stop(): Promise<void> {
    this.stopping = true;
    this.unsubscribeWakeup?.();
    this.unsubscribeWakeup = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.active) await Promise.allSettled([this.active]);
  }

  private async pump(): Promise<void> {
    if (this.stopping || this.active) return;
    const execution = this.runOnce().finally(() => {
      if (this.active === execution) this.active = undefined;
    });
    this.active = execution;
    await execution;
  }

  private async runOnce(): Promise<void> {
    try {
      const task = await this.options.repository.claim();
      if (!task) return;
      await this.advance(task);
    } catch (error) {
      console.error('Failed to advance audio automation task', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private async advance(task: ClaimedAutomationTask): Promise<void> {
    try {
      if (task.cancelRequested && (await this.currentStageSettled(task))) {
        await this.options.repository.cancelAfterCurrent(task);
        return;
      }
      if (task.phase === 'transcription') await this.advanceTranscription(task);
      else if (task.phase === 'post_analysis') await this.advancePostAnalysis(task);
      else if (task.phase === 'business_analysis') await this.advanceBusiness(task);
      else if (task.phase === 'done') await this.complete(task);
    } catch (error) {
      const blocked = classifyHardBlock(error);
      if (blocked) {
        await this.options.repository.block(
          task,
          blocked.reason,
          this.capability(task),
          blocked.message,
        );
        return;
      }
      await this.fail(
        task,
        'AUTOMATION_STAGE_FAILED',
        error instanceof Error ? error.message : '自动分析阶段失败。',
        false,
      );
    }
  }

  private async advanceTranscription(task: ClaimedAutomationTask): Promise<void> {
    let revisionId = task.analysisRevisionId;
    if (!revisionId) {
      revisionId = await this.options.repository.reusableRevision(
        task.audioFileId,
        task.configuration.language,
      );
      const reused = Boolean(revisionId);
      if (!revisionId) {
        const queued = await this.options.audio.startAudioTranscription(
          task.audioFileId,
          {
            preprocessing: 'whole_file',
            segmentationMode: 'speaker_turn',
            includeAcousticEmotion:
              task.runtimeMode === 'lightweight_local' && task.pipeline.includeEmotion,
            language: task.configuration.language,
          },
          task.configuration.capabilityBindings,
        );
        revisionId = queued.revisionId;
      }
      const linked = await this.options.repository.setStageReference(task.id, {
        analysisRevisionId: revisionId,
        stageSources: { transcription: reused ? 'reused' : 'created' },
        progress: 5,
      });
      if (!linked && task.analysisRevisionId !== revisionId) return;
      return;
    }
    const state = await this.options.repository.transcriptionState(revisionId);
    if (state.status === 'failed') {
      const blocked = classifyStoredHardBlock(state.errorCode, state.errorMessage);
      if (blocked) {
        await this.options.repository.block(
          task,
          blocked.reason,
          'audio_transcription',
          blocked.message,
        );
      } else {
        await this.fail(
          task,
          state.errorCode ?? 'TRANSCRIPTION_FAILED',
          state.errorMessage ?? '音频转写失败。',
          state.errorRetryable,
        );
      }
      return;
    }
    if (state.status !== 'ready') {
      await this.options.repository.setStageReference(task.id, {
        progress: Math.max(5, Math.min(40, Math.round(state.progress * 0.4))),
      });
      return;
    }
    await this.options.audio.ensureSystemRawTranscriptSnapshot(task.audioFileId, revisionId);
    const review = await this.options.repository.speakerReviewState(revisionId);
    if (review.findingCount > 0) {
      await this.options.repository.addWarning(task.id, 'SPEAKER_REVIEW_REQUIRED');
    } else if (review.status === 'failed') {
      await this.options.repository.addWarning(task.id, 'SPEAKER_REVIEW_UNAVAILABLE');
    } else if (review.status === 'queued' || review.status === 'running') {
      await this.options.repository.addWarning(task.id, 'SPEAKER_REVIEW_PENDING');
    }
    await this.options.repository.setStageReference(task.id, {
      phase: 'post_analysis',
      progress: 45,
    });
  }

  private async advancePostAnalysis(task: ClaimedAutomationTask): Promise<void> {
    if (!task.analysisRevisionId) throw new Error('自动分析缺少 ASR 修订引用。');
    let emotionJobId = task.emotionJobId;
    let roleJobId = task.roleJobId;
    let emotionSource = task.stageSources.emotion;
    let roleSource = task.stageSources.role;
    const reusable = await this.options.repository.postAnalysisReferences(
      task.analysisRevisionId,
      task.configuration.language,
    );
    if (task.pipeline.includeEmotion && !emotionJobId) {
      emotionJobId = reusable.emotionJobId;
      if (emotionJobId) {
        emotionSource = task.stageSources.transcription === 'created' ? 'created' : 'reused';
      }
      if (!emotionJobId && task.runtimeMode !== 'lightweight_local') {
        emotionJobId = (
          await this.options.audio.startAudioPostAnalysis(
            task.audioFileId,
            'emotion',
            task.configuration.capabilityBindings,
            task.configuration.language,
          )
        ).jobId;
        emotionSource = 'created';
      }
    } else if (!task.pipeline.includeEmotion) {
      emotionSource = 'skipped';
    }
    if (task.pipeline.includeRole && !roleJobId) {
      roleJobId = reusable.roleJobId;
      if (roleJobId) roleSource = 'reused';
      if (!roleJobId) {
        roleJobId = (
          await this.options.audio.startAudioPostAnalysis(
            task.audioFileId,
            'role',
            task.configuration.capabilityBindings,
            task.configuration.language,
          )
        ).jobId;
        roleSource = 'created';
      }
    } else if (!task.pipeline.includeRole) {
      roleSource = 'skipped';
    }
    // 轻量本地模式只能在 ASR 阶段产出声学情绪；复用没有该结果的旧转写时继续后续阶段，
    // 但必须留下明确警告，避免批次被误认为完整分析。
    if (task.pipeline.includeEmotion && !emotionJobId) {
      emotionSource = 'unavailable';
      await this.options.repository.addWarning(task.id, 'EMOTION_UNAVAILABLE');
    }
    if (
      emotionJobId !== task.emotionJobId ||
      roleJobId !== task.roleJobId ||
      emotionSource !== task.stageSources.emotion ||
      roleSource !== task.stageSources.role
    ) {
      const linked = await this.options.repository.setStageReference(task.id, {
        ...(emotionJobId ? { emotionJobId } : {}),
        ...(roleJobId ? { roleJobId } : {}),
        stageSources: {
          ...(emotionSource ? { emotion: emotionSource } : {}),
          ...(roleSource ? { role: roleSource } : {}),
        },
        progress: 50,
      });
      if (!linked) {
        if (emotionJobId && emotionJobId !== task.emotionJobId)
          await this.options.repository.cancelPostAnalysisJob?.(emotionJobId);
        if (roleJobId && roleJobId !== task.roleJobId)
          await this.options.repository.cancelPostAnalysisJob?.(roleJobId);
      }
      return;
    }
    const states = await Promise.all([
      emotionJobId ? this.options.repository.postAnalysisState(emotionJobId) : undefined,
      roleJobId ? this.options.repository.postAnalysisState(roleJobId) : undefined,
    ]);
    if (states.some((state) => state && !terminal(state))) return;
    const stageNames = ['EMOTION', 'ROLE'] as const;
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      if (!state || state.status !== 'failed') continue;
      const blocked = classifyStoredHardBlock(state.errorCode, state.errorMessage);
      if (blocked) {
        await this.options.repository.block(
          task,
          blocked.reason,
          index === 0 ? 'audio_emotion' : 'audio_role',
          blocked.message,
        );
        return;
      }
      await this.options.repository.addWarning(task.id, `${stageNames[index]}_UNAVAILABLE`);
    }
    await this.options.repository.setStageReference(task.id, {
      phase: 'business_analysis',
      progress: 75,
    });
  }

  private async advanceBusiness(task: ClaimedAutomationTask): Promise<void> {
    if (!task.pipeline.includeBusinessAnalysis) {
      await this.options.repository.setStageReference(task.id, {
        stageSources: { businessAnalysis: 'skipped' },
      });
      await this.complete(task);
      return;
    }
    if (!task.businessJobId) {
      const queued = await this.options.audio.startAudioBusinessAnalysis(
        task.audioFileId,
        {
          groupId: task.groupId,
          force: false,
          language: task.configuration.language,
        },
        task.configuration.capabilityBindings,
        {
          analysisTiming: task.configuration.analysisTiming,
          contentFocus: task.configuration.contentFocus,
          tone: task.configuration.tone,
          customTags: task.configuration.customTags,
          knowledgeBaseIds: task.configuration.knowledgeBaseIds,
        },
      );
      const linked = await this.options.repository.setStageReference(task.id, {
        businessJobId: queued.jobId,
        stageSources: { businessAnalysis: queued.reused ? 'reused' : 'created' },
        progress: 80,
      });
      if (!linked) {
        await this.options.repository.cancelBusinessJob?.(queued.jobId);
        return;
      }
      await this.options.repository.setBusinessLimitations(queued.jobId, task.warningCodes);
      return;
    }
    const state = await this.options.repository.businessState(task.businessJobId);
    if (state.status === 'ready') {
      await this.complete(task);
      return;
    }
    if (state.status === 'failed') {
      const blocked = classifyStoredHardBlock(state.errorCode, state.errorMessage);
      if (blocked) {
        await this.options.repository.block(
          task,
          blocked.reason,
          'business_analysis',
          blocked.message,
        );
      } else {
        await this.fail(
          task,
          state.errorCode ?? 'BUSINESS_ANALYSIS_FAILED',
          state.errorMessage ?? '业务分析失败。',
          state.errorRetryable,
        );
      }
    }
  }

  private capability(task: ClaimedAutomationTask): string {
    if (task.phase === 'transcription') return 'audio_transcription';
    if (task.phase === 'business_analysis') return 'business_analysis';
    return 'audio_post_analysis';
  }

  /** 完成父任务，并仅由创建批次终态事件的调用生成一次清单。 */
  private async complete(task: ClaimedAutomationTask): Promise<void> {
    const terminalEvent = await this.options.repository.complete(task, task.warningCodes);
    await this.writeBatchReport(task.batchId, terminalEvent);
  }

  /** 失败父任务，并在批次因此收敛时生成同一份终态清单。 */
  private async fail(
    task: ClaimedAutomationTask,
    code: string,
    message: string,
    retryable: boolean,
  ): Promise<void> {
    await this.recordUnavailableStageSources(task).catch((error) => {
      console.warn('[audio-analysis-batch-report] failed to record terminal stage sources', {
        batchId: task.batchId,
        taskId: task.id,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    });
    const terminalEvent = await this.options.repository.fail(task, code, message, retryable);
    await this.writeBatchReport(task.batchId, terminalEvent);
  }

  /** 终态失败时只补充可由当前配置和缺失引用确定的来源，不猜测已有历史引用。 */
  private async recordUnavailableStageSources(task: ClaimedAutomationTask): Promise<void> {
    const stageSources: AutomationStageSources = {};
    if (!task.stageSources.transcription && !task.analysisRevisionId) {
      stageSources.transcription = 'unavailable';
    }
    if (!task.stageSources.emotion) {
      if (!task.pipeline.includeEmotion) stageSources.emotion = 'skipped';
      else if (!task.emotionJobId) stageSources.emotion = 'unavailable';
    }
    if (!task.stageSources.role) {
      if (!task.pipeline.includeRole) stageSources.role = 'skipped';
      else if (!task.roleJobId) stageSources.role = 'unavailable';
    }
    if (!task.stageSources.businessAnalysis) {
      if (!task.pipeline.includeBusinessAnalysis) stageSources.businessAnalysis = 'skipped';
      else if (!task.businessJobId) stageSources.businessAnalysis = 'unavailable';
    }
    if (Object.keys(stageSources).length) {
      await this.options.repository.setStageReference(task.id, { stageSources });
    }
  }

  /** 批次清单属于旁路诊断，读取或写入失败不得改变父任务终态。 */
  private async writeBatchReport(
    batchId: string,
    terminalEvent: AutomationTerminalEventType | null,
  ): Promise<void> {
    if (!terminalEvent) return;
    try {
      const manifest = await this.options.repository.batchExecutionManifest(batchId);
      const report = (this.options.reporter ?? noOpAiExecutionReporter).start({
        kind: 'audio-analysis-batch',
        name: 'EchoWave one-click audio analysis batch',
        fileId: batchId,
        metadata: { batchId, terminalEvent, manifest },
      });
      await report.finish({ status: terminalEvent === 'FAILED' ? 'failed' : 'completed' });
    } catch (error) {
      console.warn('[audio-analysis-batch-report] failed to create batch report', {
        batchId,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private async currentStageSettled(task: ClaimedAutomationTask): Promise<boolean> {
    if (task.phase === 'transcription' && task.analysisRevisionId) {
      return terminal(await this.options.repository.transcriptionState(task.analysisRevisionId));
    }
    if (task.phase === 'post_analysis') {
      const states = await Promise.all(
        [task.emotionJobId, task.roleJobId]
          .filter((id): id is string => Boolean(id))
          .map((id) => this.options.repository.postAnalysisState(id)),
      );
      return states.every(terminal);
    }
    if (task.phase === 'business_analysis' && task.businessJobId) {
      return terminal(await this.options.repository.businessState(task.businessJobId));
    }
    return true;
  }
}
