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
import type { WorkerWakeupSource } from '../../../infrastructure/workerWakeup.ts';
import { classifyHardBlock, classifyStoredHardBlock } from './errorClassification.ts';
import {
  AudioAutomationRepository,
  type ChildJobState,
  type ClaimedAutomationTask,
} from './repository.ts';

const SAFETY_SCAN_MS = 15_000;

type AutomationWorkerOptions = {
  repository: AudioAutomationRepository;
  audio: AudioService;
  wakeup?: WorkerWakeupSource;
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
      else if (task.phase === 'done')
        await this.options.repository.complete(task, task.warningCodes);
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
      await this.options.repository.fail(
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
      revisionId = await this.options.repository.reusableRevision(task.audioFileId);
      if (!revisionId) {
        const queued = await this.options.audio.startAudioTranscription(
          task.audioFileId,
          {
            preprocessing: 'whole_file',
            segmentationMode: 'speaker_turn',
            includeAcousticEmotion:
              task.runtimeMode === 'lightweight_local' && task.pipeline.includeEmotion,
          },
          task.configuration.capabilityBindings,
        );
        revisionId = queued.revisionId;
      }
      await this.options.repository.setStageReference(task.id, {
        analysisRevisionId: revisionId,
        progress: 5,
      });
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
        await this.options.repository.fail(
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
    const reusable = await this.options.repository.postAnalysisReferences(task.analysisRevisionId);
    if (task.pipeline.includeEmotion && !emotionJobId) {
      emotionJobId = reusable.emotionJobId;
      if (!emotionJobId && task.runtimeMode !== 'lightweight_local') {
        emotionJobId = (
          await this.options.audio.startAudioPostAnalysis(
            task.audioFileId,
            'emotion',
            task.configuration.capabilityBindings,
          )
        ).jobId;
      }
    }
    if (task.pipeline.includeRole && !roleJobId) {
      roleJobId = reusable.roleJobId;
      if (!roleJobId) {
        roleJobId = (
          await this.options.audio.startAudioPostAnalysis(
            task.audioFileId,
            'role',
            task.configuration.capabilityBindings,
          )
        ).jobId;
      }
    }
    if (emotionJobId !== task.emotionJobId || roleJobId !== task.roleJobId) {
      await this.options.repository.setStageReference(task.id, {
        ...(emotionJobId ? { emotionJobId } : {}),
        ...(roleJobId ? { roleJobId } : {}),
        progress: 50,
      });
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
      await this.options.repository.complete(task, task.warningCodes);
      return;
    }
    if (!task.businessJobId) {
      const queued = await this.options.audio.startAudioBusinessAnalysis(
        task.audioFileId,
        {
          groupId: task.groupId,
          force: false,
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
      await this.options.repository.setStageReference(task.id, {
        businessJobId: queued.jobId,
        progress: 80,
      });
      await this.options.repository.setBusinessLimitations(queued.jobId, task.warningCodes);
      return;
    }
    const state = await this.options.repository.businessState(task.businessJobId);
    if (state.status === 'ready') {
      await this.options.repository.complete(task, task.warningCodes);
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
        await this.options.repository.fail(
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
