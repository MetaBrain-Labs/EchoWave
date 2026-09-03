/**
 * DashScope 音频转写后台 worker。
 *
 * 按数据库通知领取 PostgreSQL 中的 revision，将供应商任务拆为提交、终态发现和统一完成阶段；
 * Polling 与 EventBridge 只负责发现终态，结果处理始终走同一后台路径。
 *
 * Responsibilities:
 * - 在可配置在途上限内完成预处理、OSS 暂存和供应商任务提交。
 * - 在 Polling 模式执行可恢复的单次状态查询，避免长时间占用 worker。
 * - 优先消费已持久化终态，下载结果并完成时间轴恢复、发布和清理。
 *
 * Notes:
 * - 当前本地文件存储只支持单 API 实例；提交与完成阶段均保持单 worker 执行。
 * - 供应商查询按持久化截止时间精确唤醒，15 秒安全扫描仅负责通知或定时器遗漏恢复。
 */
import type { AudioFailureDetails } from '@echowave/contracts';

import {
  noOpAiExecutionRecorder,
  noOpAiExecutionReporter,
  type AiExecutionRecorder,
  type AiExecutionReporter,
} from '../../../ai-observability/executionReporter.ts';
import { runReportedStep } from '../../../ai-runtime/reportedStep.ts';
import type { LiveUpdateBroker } from '../../../infrastructure/liveUpdateBroker.ts';
import type { WorkerWakeupSource } from '../../../infrastructure/workerWakeup.ts';
import {
  AudioAnalysisRepository,
  type ClaimedAudioTranscription,
  type TranscriptDraft,
} from './repository.ts';
import { AudioInputPreprocessor, AudioPreprocessingError } from './audioPreprocessor.ts';
import type { DashScopeFileTranscription } from './dashScopeFileTranscription.ts';
import { handleDashScopeTaskResult as persistDashScopeTaskResult } from './dashScopeTaskResult.ts';
import { AudioTranscriptionProviderError } from './errors.ts';
import type { AudioArtifactStore } from './audioArtifactStore.ts';
import { restoreOriginalTimeline, VoiceActivityError } from './voiceActivity.ts';
import { detectSpeakerReviewCandidates } from '../speaker-review/rules.ts';
import type { PrimaryOssStore } from '../runtime-mode/primaryOssStore.ts';
import path from 'node:path';

const AUDIO_TRANSCRIPTION_LANGUAGE = 'zh' as const;
const POLL_DELAYS_MS = [2_000, 5_000, 10_000, 15_000] as const;
const SAFETY_POLL_INTERVAL_MS = 15_000;
const MIN_DEADLINE_DELAY_MS = 50;

type WorkerOptions = {
  dashScope?: DashScopeFileTranscription;
  maxInFlight: number;
  notifyMode?: 'polling' | 'eventbridge';
  ossStaging?: AudioArtifactStore;
  resolveProviders?: (job: ClaimedAudioTranscription) => Promise<TranscriptionProviders>;
  preprocessor: AudioInputPreprocessor;
  repository: AudioAnalysisRepository;
  reporter?: AiExecutionReporter;
  liveUpdates?: LiveUpdateBroker;
  wakeup?: WorkerWakeupSource;
  sourceTempDirectory?: string;
  onTranscriptionPublished?: (job: ClaimedAudioTranscription) => Promise<void>;
};

type TranscriptionProviders = {
  dashScope: DashScopeFileTranscription;
  notifyMode: 'polling' | 'eventbridge';
  ossStaging?: AudioArtifactStore;
  primaryStorage?: PrimaryOssStore;
};

type WorkItem =
  | { kind: 'submit'; job: ClaimedAudioTranscription }
  | { kind: 'poll'; job: ClaimedAudioTranscription }
  | { kind: 'complete'; job: ClaimedAudioTranscription }
  | { kind: 'timeout'; job: ClaimedAudioTranscription };

function failureDetails(error: unknown): AudioFailureDetails {
  if (error instanceof AudioTranscriptionProviderError && error.details) return error.details;
  if (error instanceof AudioPreprocessingError || error instanceof VoiceActivityError) {
    return {
      category: 'preprocessing',
      chunkIndex: null,
      chunkCount: null,
      structureAttempts: 0,
      issues: [{ path: '$', code: error.code, message: error.message.slice(0, 500) }],
      outputLength: null,
      outputSha256: null,
    };
  }
  return {
    category: 'internal',
    chunkIndex: null,
    chunkCount: null,
    structureAttempts: 0,
    issues: [{ path: '$', code: 'internal_error', message: '音频转写发生内部错误。' }],
    outputLength: null,
    outputSha256: null,
  };
}

/** 管理单执行器、可配置供应商在途量的双模式异步转写任务。 */
export class AudioTranscriptionWorker {
  private active?: Promise<void>;
  private pumping = false;
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private deadlineTimer?: NodeJS.Timeout;
  private deadlineVersion = 0;
  private unsubscribeWakeup?: () => void;

  constructor(private readonly options: WorkerOptions) {}

  private async providers(job: ClaimedAudioTranscription): Promise<TranscriptionProviders> {
    if (this.options.resolveProviders) return this.options.resolveProviders(job);
    if (!this.options.dashScope) {
      throw new AudioTranscriptionProviderError(
        'MODEL_UNAVAILABLE',
        'DashScope 转写尚未配置。',
        false,
      );
    }
    return {
      dashScope: this.options.dashScope,
      notifyMode: this.options.notifyMode ?? 'polling',
      ...(this.options.ossStaging ? { ossStaging: this.options.ossStaging } : {}),
    };
  }

  /** 恢复中断阶段并启动通知订阅、精确截止时间调度与低频安全扫描。 */
  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    await this.options.repository.resetInterruptedTranscriptions(
      this.options.notifyMode ?? 'polling',
    );
    this.unsubscribeWakeup = this.options.wakeup?.subscribe(
      'audio-transcription',
      () => void this.pump(),
    );
    this.timer = setInterval(() => void this.pump(), SAFETY_POLL_INTERVAL_MS);
    this.timer.unref();
    void this.pump();
  }

  /** 停止领取新阶段并等待当前阶段安全收敛。 */
  async stop(): Promise<void> {
    this.stopping = true;
    this.unsubscribeWakeup?.();
    this.unsubscribeWakeup = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = undefined;
    this.deadlineVersion += 1;
    if (this.active) await Promise.allSettled([this.active]);
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.stopping || this.active) return;
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = undefined;
    this.deadlineVersion += 1;
    this.pumping = true;
    let claimed = false;
    try {
      const work = await this.claimWork();
      if (!work) return;
      claimed = true;
      if (work.kind !== 'poll') this.notify(work.job, false);
      const execution = this.execute(work).finally(() => {
        if (this.active === execution) this.active = undefined;
        if (!this.stopping) void this.pump();
      });
      this.active = execution;
    } catch (error) {
      console.error('Failed to claim audio transcription work', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.pumping = false;
      if (!claimed && !this.stopping) void this.scheduleNextDeadline();
    }
  }

  /** 为供应商 Polling 与六小时超时设置最近截止时间；失败时由低频安全扫描恢复。 */
  private async scheduleNextDeadline(): Promise<void> {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = undefined;
    if (this.stopping) return;
    const deadlineVersion = ++this.deadlineVersion;
    // 测试替身和旧的运行时装配可能尚未实现截止时间查询；此时仍由安全扫描兜底。
    if (typeof this.options.repository.nextWorkerWakeAt !== 'function') return;
    try {
      const wakeAt = await this.options.repository.nextWorkerWakeAt(
        this.options.notifyMode ?? 'polling',
      );
      if (deadlineVersion !== this.deadlineVersion || !wakeAt || this.stopping || this.active) {
        return;
      }
      const delay = Math.max(MIN_DEADLINE_DELAY_MS, wakeAt.getTime() - Date.now());
      this.deadlineTimer = setTimeout(() => {
        this.deadlineTimer = undefined;
        void this.pump();
      }, delay);
      this.deadlineTimer.unref();
    } catch (error) {
      console.warn('Failed to schedule audio transcription deadline', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private notify(job: ClaimedAudioTranscription, terminal: boolean): void {
    if (!job.dataSource) return;
    this.options.liveUpdates?.publish({
      kind: 'data-source-audio',
      dataSourceId: job.dataSource.id,
      audioFileId: job.audioFileId,
      terminal,
    });
  }

  private async claimWork(): Promise<WorkItem | undefined> {
    const terminal = await this.options.repository.claimTerminalCompletion();
    if (terminal) return { kind: 'complete', job: terminal };
    const timeout = await this.options.repository.claimExpiredTranscription();
    if (timeout) return { kind: 'timeout', job: timeout };
    if (this.options.resolveProviders || this.options.notifyMode !== 'eventbridge') {
      const poll = await this.options.repository.claimPollingDiscovery();
      if (poll) return { kind: 'poll', job: poll };
    }
    const submission = await this.options.repository.claimTranscription(this.options.maxInFlight);
    return submission ? { kind: 'submit', job: submission } : undefined;
  }

  private async execute(work: WorkItem): Promise<void> {
    if (work.kind === 'poll') {
      await this.discoverByPolling(work.job);
      return;
    }
    const report = this.startReport(work.job, work.kind);
    const startedAt = Date.now();
    let providers: TranscriptionProviders | undefined;
    try {
      providers = await this.providers(work.job);
      if (work.kind === 'submit') {
        await this.submit(work.job, report, providers);
        await report.finish({
          status: 'completed',
          metadata: { phase: 'submit', durationMs: Date.now() - startedAt },
        });
        return;
      }
      if (work.kind === 'timeout') {
        throw new AudioTranscriptionProviderError(
          'MODEL_TIMEOUT',
          'DashScope 文件转写任务在六小时内未发现完成终态。',
          true,
        );
      }
      const segments = await this.handleDashScopeTaskResult(work.job, report, providers);
      await report.finish({
        status: 'completed',
        metadata: {
          phase: 'complete',
          durationMs: Date.now() - startedAt,
          displaySegmentCount: segments.length,
          speakerCount: new Set(segments.map((segment) => segment.speakerKey)).size,
        },
      });
      console.info('Audio transcription completed from provider terminal result', {
        audioFileId: work.job.audioFileId,
        revisionId: work.job.revisionId,
      });
    } catch (error) {
      await this.finishFailure(work.job, report, error, startedAt, providers);
    }
  }

  private startReport(
    job: ClaimedAudioTranscription,
    phase: WorkItem['kind'],
  ): AiExecutionRecorder {
    return (this.options.reporter ?? noOpAiExecutionReporter).start({
      kind: 'audio-transcription',
      name: `EchoWave audio transcription ${phase}`,
      metadata: {
        phase,
        source: { dataSource: job.dataSource, ingestionRunId: job.ingestionRunId },
        audio: {
          audioFileId: job.audioFileId,
          title: job.title,
          originalFilename: job.originalFilename,
          mimeType: job.mimeType,
          sizeBytes: job.sizeBytes,
          durationMs: job.durationMs,
        },
        revision: {
          revisionId: job.revisionId,
          revisionNo: job.revisionNo,
          preprocessingMode: job.preprocessingMode,
          model: job.model,
          provider: job.provider,
          language: AUDIO_TRANSCRIPTION_LANGUAGE,
        },
      },
    });
  }

  /** 完成音频准备和任务提交，持久化 task ID 后立即释放 worker。 */
  private async submit(
    job: ClaimedAudioTranscription,
    report: AiExecutionRecorder,
    providers: TranscriptionProviders,
  ): Promise<void> {
    const { repository, preprocessor } = this.options;
    const { dashScope, ossStaging } = providers;
    if (!ossStaging) {
      throw new AudioTranscriptionProviderError(
        'MODEL_UNAVAILABLE',
        'DashScope 转写所需的 OSS 尚未完整配置。',
        false,
      );
    }

    let objectKey = job.providerArtifactKey;
    if (!objectKey) {
      let materialized: Awaited<ReturnType<PrimaryOssStore['materialize']>> | undefined;
      if (job.storageBackend === 'aliyun_oss') {
        if (!providers.primaryStorage || !this.options.sourceTempDirectory) {
          throw new AudioTranscriptionProviderError(
            'MODEL_UNAVAILABLE',
            '对象存储源音频读取能力未完整配置。',
            false,
          );
        }
        materialized = await providers.primaryStorage.materialize(
          job.storageKey,
          path.resolve(this.options.sourceTempDirectory, 'source-materialized', job.revisionId),
          job.originalFilename ?? 'source-audio',
        );
      }
      const wholeFile = await runReportedStep(report, 'preprocess-whole-file', async () => {
        await repository.updateActivity(job, { stage: 'preprocessing', progress: 5 });
        this.notify(job, false);
        return preprocessor.createWholeFile(job, materialized?.path);
      });
      await repository.recordPreprocessing(job, wholeFile.manifest ?? null);
      try {
        objectKey = await runReportedStep(report, 'provider-staging-upload', () =>
          ossStaging.upload(job.revisionId, wholeFile.path),
        );
      } finally {
        await materialized?.cleanup().catch(() => undefined);
      }
      job.preprocessingManifest = wholeFile.manifest ?? null;
      job.providerArtifactKey = objectKey;
      await repository.recordProviderArtifact(job, objectKey, job.preprocessingManifest);
    }

    const providerDurationMs = job.preprocessingManifest?.processedDurationMs ?? job.durationMs;
    await repository.updateActivity(job, { stage: 'transcribing', progress: 15 });
    this.notify(job, false);
    const taskId = await runReportedStep(report, 'dashscope-submit', () =>
      dashScope.submit(
        ossStaging.signedGetUrl(objectKey!),
        {
          revisionId: job.revisionId,
          durationMs: providerDurationMs,
          preprocessing: job.preprocessingMode,
        },
        job.expectedSpeakerCount ?? undefined,
      ),
    );
    const submittedAt = new Date();
    await repository.recordProviderTask(job, taskId, submittedAt, providers.notifyMode);
    job.providerTaskId = taskId;
    job.providerSubmittedAt = submittedAt;
    await repository.updateActivity(job, { stage: 'awaiting_result', progress: 35 });
    this.notify(job, false);
  }

  /** 执行一次供应商状态查询；未完成或瞬时失败只安排下一次查询。 */
  private async discoverByPolling(job: ClaimedAudioTranscription): Promise<void> {
    const startedAt = Date.now();
    let providers: TranscriptionProviders | undefined;
    const taskId = job.providerTaskId;
    if (!taskId) {
      await this.finishFailure(
        job,
        noOpAiExecutionRecorder,
        new AudioTranscriptionProviderError(
          'INVALID_MODEL_OUTPUT',
          'Polling 任务缺少 DashScope task ID。',
          true,
        ),
        startedAt,
        providers,
      );
      return;
    }

    const attempt = job.providerPollAttempt + 1;
    const delayMs = POLL_DELAYS_MS[Math.min(attempt - 1, POLL_DELAYS_MS.length - 1)]!;
    try {
      providers = await this.providers(job);
      const status = await providers.dashScope.queryTask(taskId, attempt, {
        revisionId: job.revisionId,
        durationMs: job.preprocessingManifest?.processedDurationMs ?? job.durationMs,
        preprocessing: job.preprocessingMode,
      });
      if (status.status === 'PENDING' || status.status === 'RUNNING') {
        await this.options.repository.scheduleNextPoll(job, attempt, delayMs);
        return;
      }
      await persistDashScopeTaskResult(this.options.repository, {
        source: 'polling',
        eventId: null,
        taskId,
        status: status.status,
        receivedAt: new Date(),
        resultUrl: status.resultUrl,
        errorCode: status.errorCode,
        errorMessage: status.errorMessage,
      });
    } catch (error) {
      if (
        error instanceof AudioTranscriptionProviderError &&
        error.retryable &&
        error.code !== 'INVALID_MODEL_OUTPUT'
      ) {
        await this.options.repository.scheduleNextPoll(job, attempt, delayMs);
        return;
      }
      await this.finishFailure(job, noOpAiExecutionRecorder, error, startedAt, providers);
    }
  }

  /** 消费已持久化终态，下载结果并发布录音级 Speaker 段落。 */
  private async handleDashScopeTaskResult(
    job: ClaimedAudioTranscription,
    report: AiExecutionRecorder,
    providers: TranscriptionProviders,
  ): Promise<TranscriptDraft[]> {
    if (job.providerTerminalStatus !== 'SUCCEEDED') {
      throw new AudioTranscriptionProviderError(
        'MODEL_UNAVAILABLE',
        'DashScope 文件转写未成功完成。',
        true,
      );
    }
    if (!job.providerTaskId || !job.providerTerminalResultUrl) {
      throw new AudioTranscriptionProviderError(
        'INVALID_MODEL_OUTPUT',
        'DashScope 成功终态缺少有效的转写结果地址。',
        true,
      );
    }

    const providerDurationMs = job.preprocessingManifest?.processedDurationMs ?? job.durationMs;
    const result = await runReportedStep(report, 'dashscope-terminal-result', () =>
      providers.dashScope.fetchResult(job.providerTaskId!, job.providerTerminalResultUrl!, {
        revisionId: job.revisionId,
        durationMs: providerDurationMs,
        preprocessing: job.preprocessingMode,
      }),
    );
    report.recordModelCall({
      name: 'audio-file-transcription',
      displayName: '识别整段音频并生成带时间戳的说话人转写',
      provider: 'dashscope',
      model: job.model,
      status: 'completed',
      attempt: 1,
      durationMs: Math.max(
        0,
        (job.providerTerminalReceivedAt?.getTime() ?? Date.now()) -
          (job.providerSubmittedAt?.getTime() ?? Date.now()),
      ),
      inputTokens: null,
      outputTokens: null,
      reasoningMode: 'unsupported',
      input: {
        kind: 'file-transcription',
        audio: '[OMITTED_AUDIO]',
        language: AUDIO_TRANSCRIPTION_LANGUAGE,
        durationMs: providerDurationMs,
        preprocessingMode: job.preprocessingMode,
        diarizationEnabled: true,
        timestampGranularity: 'word',
      },
      output: { language: AUDIO_TRANSCRIPTION_LANGUAGE, segments: result.segments },
    });

    let segments = result.segments;
    if (job.preprocessingManifest) {
      try {
        segments = restoreOriginalTimeline(result.segments, job.preprocessingManifest);
      } catch (error) {
        if (error instanceof VoiceActivityError && error.code === 'INVALID_VAD_TIMELINE') {
          throw new AudioTranscriptionProviderError('INVALID_MODEL_OUTPUT', error.message, true);
        }
        throw error;
      }
    }
    await this.options.repository.updateActivity(job, { stage: 'publishing', progress: 95 });
    this.notify(job, false);
    const reviewFindings = detectSpeakerReviewCandidates(segments);
    await runReportedStep(report, 'publish', () =>
      this.options.repository.publishTranscription(
        job,
        segments,
        {
          language: AUDIO_TRANSCRIPTION_LANGUAGE,
          diarizationRequested: true,
          diarizationObserved: true,
          responseGranularity: 'word',
          segmentationMode: 'speaker_turn',
          speakerIdentityScope: 'recording',
        },
        reviewFindings,
      ),
    );
    this.notify(job, true);
    await this.cleanupProviderArtifact(job, report, providers.ossStaging);
    await this.options.preprocessor.cleanup(job);
    if (this.options.onTranscriptionPublished) {
      try {
        await this.options.onTranscriptionPublished(job);
        report.recordStep({ name: 'source-cleanup', status: 'completed' });
      } catch {
        report.recordStep({ name: 'source-cleanup', status: 'failed' });
      }
    }
    report.recordOutput(segments);
    return segments;
  }

  private async finishFailure(
    job: ClaimedAudioTranscription,
    report: AiExecutionRecorder,
    error: unknown,
    startedAt: number,
    providers?: TranscriptionProviders,
  ): Promise<void> {
    const known =
      error instanceof AudioPreprocessingError ||
      error instanceof AudioTranscriptionProviderError ||
      error instanceof VoiceActivityError;
    const code = known ? error.code : 'INTERNAL_ERROR';
    const message = known ? error.message : '音频转写失败，请稍后重试。';
    const retryable = known ? error.retryable : true;
    const details = failureDetails(error);
    const providerHttpStatus =
      error instanceof AudioTranscriptionProviderError ? error.providerHttpStatus : undefined;
    let persistenceError: unknown;
    let finalFailure = true;
    try {
      finalFailure =
        (await this.options.repository.failTranscription(
          job,
          code,
          message,
          retryable,
          details,
        )) !== false;
      this.notify(job, finalFailure);
      report.recordStep({ name: 'persist-failure', status: 'completed' });
    } catch (reason) {
      persistenceError = reason;
      report.recordStep({ name: 'persist-failure', status: 'failed' });
    }
    if (finalFailure) {
      try {
        await this.options.preprocessor.cleanup(job);
        report.recordStep({ name: 'cleanup-failure', status: 'completed' });
      } catch {
        report.recordStep({ name: 'cleanup-failure', status: 'failed' });
      }
      await this.cleanupProviderArtifact(job, report, providers?.ossStaging);
    }
    await report.finish({
      status: 'failed',
      error,
      metadata: {
        code,
        retryable,
        retryScheduled: !finalFailure,
        details,
        durationMs: Date.now() - startedAt,
        ...(providerHttpStatus === undefined ? {} : { providerHttpStatus }),
        ...(persistenceError
          ? {
              failurePersistenceError:
                persistenceError instanceof Error ? persistenceError.name : 'UnknownError',
            }
          : {}),
      },
    });
    const log = finalFailure ? console.error : console.warn;
    log('Audio transcription phase failed', {
      audioFileId: job.audioFileId,
      code,
      revisionId: job.revisionId,
      retryable,
      retryScheduled: !finalFailure,
    });
    if (persistenceError) throw persistenceError;
  }

  /** 终态后尽力删除 OSS；失败时保留对象键交给生命周期规则兜底。 */
  private async cleanupProviderArtifact(
    job: ClaimedAudioTranscription,
    report: AiExecutionRecorder,
    ossStaging?: AudioArtifactStore,
  ): Promise<void> {
    if (!job.providerArtifactKey || !ossStaging) return;
    try {
      await ossStaging.delete(job.providerArtifactKey);
      await this.options.repository.clearProviderArtifact(job);
      job.providerArtifactKey = null;
      report.recordStep({ name: 'oss-staging-cleanup', status: 'completed' });
    } catch {
      report.recordStep({ name: 'oss-staging-cleanup', status: 'failed' });
      console.warn('Failed to clean transient OSS transcription object', {
        revisionId: job.revisionId,
      });
    }
  }
}
