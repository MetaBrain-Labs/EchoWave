/**
 * DashScope 音频转写后台 worker。
 *
 * 周期领取 PostgreSQL 中的转写修订，顺序完成整文件转码、OSS 暂存、DashScope 异步
 * 任务恢复与轮询、严格结果发布和临时资源清理。
 *
 * Responsibilities:
 * - 保证供应商任务提交可恢复且不会因进程重启重复提交。
 * - 原子发布录音级 Speaker 段落并保留旧 active revision。
 * - 将失败安全收敛到当前修订，不暴露音频或供应商原始正文。
 *
 * Notes:
 * - 当前本地文件存储只支持单 API 实例，worker 保持单并发。
 */
import type { AudioFailureDetails } from '@echowave/contracts';

import {
  noOpAiExecutionReporter,
  type AiExecutionRecorder,
  type AiExecutionReporter,
} from '../../ai-observability/executionReporter.ts';
import {
  AudioAnalysisRepository,
  type ClaimedAudioTranscription,
  type TranscriptDraft,
} from '../persistence/audioAnalysisRepository.ts';
import { AudioInputPreprocessor, AudioPreprocessingError } from './audioPreprocessor.ts';
import type { DashScopeFileTranscription } from './dashScopeFileTranscription.ts';
import { AudioTranscriptionProviderError } from './errors.ts';
import type { OssStagingStore } from './ossStagingStore.ts';

const AUDIO_TRANSCRIPTION_LANGUAGE = 'zh' as const;

type WorkerOptions = {
  dashScope: DashScopeFileTranscription;
  ossStaging?: OssStagingStore;
  preprocessor: AudioInputPreprocessor;
  repository: AudioAnalysisRepository;
  reporter?: AiExecutionReporter;
};

async function reportedStep<T>(
  report: AiExecutionRecorder,
  name: string,
  run: () => Promise<T>,
  metadata?: (value: T) => Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now();
  report.recordStep({ name, status: 'started' });
  try {
    const value = await run();
    report.recordStep({
      name,
      status: 'completed',
      durationMs: Date.now() - startedAt,
      ...(metadata ? { metadata: metadata(value) } : {}),
    });
    return value;
  } catch (error) {
    report.recordStep({ name, status: 'failed', durationMs: Date.now() - startedAt });
    throw error;
  }
}

function failureDetails(error: unknown): AudioFailureDetails {
  if (error instanceof AudioTranscriptionProviderError && error.details) return error.details;
  if (error instanceof AudioPreprocessingError) {
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

/** 管理单并发 DashScope 整文件转写任务的领取、恢复和收敛。 */
export class AudioTranscriptionWorker {
  private active?: Promise<void>;
  private pumping = false;
  private stopping = false;
  private timer?: NodeJS.Timeout;

  constructor(private readonly options: WorkerOptions) {}

  /** 重新排队中断的 DashScope 任务后启动周期领取。 */
  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    await this.options.repository.resetInterruptedTranscriptions();
    this.timer = setInterval(() => void this.pump(), 750);
    this.timer.unref();
    void this.pump();
  }

  /** 停止领取新任务并等待当前供应商调用安全收敛。 */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.active) await Promise.allSettled([this.active]);
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.stopping || this.active) return;
    this.pumping = true;
    try {
      const job = await this.options.repository.claimTranscription();
      if (!job) return;
      const execution = this.execute(job).finally(() => {
        if (this.active === execution) this.active = undefined;
        if (!this.stopping) void this.pump();
      });
      this.active = execution;
    } catch (error) {
      console.error('Failed to claim audio transcription job', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.pumping = false;
    }
  }

  private async execute(job: ClaimedAudioTranscription): Promise<void> {
    const startedAt = Date.now();
    const report = (this.options.reporter ?? noOpAiExecutionReporter).start({
      kind: 'audio-transcription',
      name: 'EchoWave audio transcription',
      metadata: {
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
    try {
      const segments = await this.executeDashScope(job, report);
      const durationMs = Date.now() - startedAt;
      await report.finish({
        status: 'completed',
        metadata: {
          durationMs,
          networkChunkCount: 1,
          diarizationObserved: true,
          diarizationRequested: true,
          language: AUDIO_TRANSCRIPTION_LANGUAGE,
          responseGranularity: 'segment',
          segmentationMode: 'speaker_turn',
          speakerIdentityScope: 'recording',
          displaySegmentCount: segments.length,
          speakerCount: new Set(segments.map((segment) => segment.speakerKey)).size,
        },
      });
      console.info('Audio transcription completed', {
        audioFileId: job.audioFileId,
        durationMs,
        revisionId: job.revisionId,
      });
    } catch (error) {
      await this.finishFailure(job, report, error, startedAt);
    }
  }

  /** 恢复或提交 DashScope 整文件任务并原子发布录音级 Speaker 段落。 */
  private async executeDashScope(
    job: ClaimedAudioTranscription,
    report: AiExecutionRecorder,
  ): Promise<TranscriptDraft[]> {
    const { dashScope, ossStaging, repository, preprocessor } = this.options;
    if (!ossStaging) {
      throw new AudioTranscriptionProviderError(
        'MODEL_UNAVAILABLE',
        'DashScope 转写所需的 OSS 尚未完整配置。',
        false,
      );
    }

    let objectKey = job.providerArtifactKey;
    let taskId = job.providerTaskId;
    let submittedAt = job.providerSubmittedAt;
    if (!taskId) {
      if (!objectKey) {
        const wholeFile = await reportedStep(report, 'preprocess-whole-file', async () => {
          await repository.updateActivity(job, { stage: 'preprocessing', progress: 5 });
          return preprocessor.createWholeFile(job);
        });
        objectKey = await reportedStep(report, 'oss-staging-upload', () =>
          ossStaging.upload(job.revisionId, wholeFile.path),
        );
        job.providerArtifactKey = objectKey;
        await repository.recordProviderArtifact(job, objectKey);
      }
      await repository.updateActivity(job, { stage: 'transcribing', progress: 15 });
      taskId = await reportedStep(report, 'dashscope-submit', () =>
        dashScope.submit(ossStaging.signedGetUrl(objectKey!), {
          revisionId: job.revisionId,
          durationMs: job.durationMs,
        }),
      );
      submittedAt = new Date();
      job.providerTaskId = taskId;
      job.providerSubmittedAt = submittedAt;
      await repository.recordProviderTask(job, taskId, submittedAt);
    }
    if (!submittedAt) {
      throw new AudioTranscriptionProviderError(
        'INVALID_MODEL_OUTPUT',
        '已保存的 DashScope 任务缺少提交时间。',
        true,
      );
    }

    await repository.updateActivity(job, { stage: 'transcribing', progress: 35 });
    const result = await reportedStep(report, 'dashscope-poll', () =>
      dashScope.waitForResult(taskId!, submittedAt!, {
        revisionId: job.revisionId,
        durationMs: job.durationMs,
      }),
    );
    await repository.updateActivity(job, { stage: 'publishing', progress: 95 });
    await reportedStep(report, 'publish', () =>
      repository.publishTranscription(job, result.segments, {
        language: AUDIO_TRANSCRIPTION_LANGUAGE,
        diarizationRequested: true,
        diarizationObserved: true,
        responseGranularity: 'segment',
        segmentationMode: 'speaker_turn',
        speakerIdentityScope: 'recording',
      }),
    );
    await this.cleanupProviderArtifact(job, report);
    await preprocessor.cleanup(job);
    return result.segments;
  }

  private async finishFailure(
    job: ClaimedAudioTranscription,
    report: AiExecutionRecorder,
    error: unknown,
    startedAt: number,
  ): Promise<void> {
    const known =
      error instanceof AudioPreprocessingError || error instanceof AudioTranscriptionProviderError;
    const code = known ? error.code : 'INTERNAL_ERROR';
    const message = known ? error.message : '音频转写失败，请稍后重试。';
    const retryable = known ? error.retryable : true;
    const details = failureDetails(error);
    const providerHttpStatus =
      error instanceof AudioTranscriptionProviderError ? error.providerHttpStatus : undefined;
    let persistenceError: unknown;
    try {
      await this.options.repository.failTranscription(job, code, message, retryable, details);
      report.recordStep({ name: 'persist-failure', status: 'completed' });
    } catch (reason) {
      persistenceError = reason;
      report.recordStep({ name: 'persist-failure', status: 'failed' });
    }
    try {
      await this.options.preprocessor.cleanup(job);
      report.recordStep({ name: 'cleanup-failure', status: 'completed' });
    } catch {
      report.recordStep({ name: 'cleanup-failure', status: 'failed' });
    }
    await this.cleanupProviderArtifact(job, report);
    await report.finish({
      status: 'failed',
      error,
      metadata: {
        code,
        retryable,
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
    console.error('Audio transcription failed', {
      audioFileId: job.audioFileId,
      code,
      revisionId: job.revisionId,
      retryable,
    });
    if (persistenceError) throw persistenceError;
  }

  /** 供应商任务终止后尽力清理 OSS；失败时保留对象键交给生命周期规则兜底。 */
  private async cleanupProviderArtifact(
    job: ClaimedAudioTranscription,
    report: AiExecutionRecorder,
  ): Promise<void> {
    if (!job.providerArtifactKey || !this.options.ossStaging) return;
    try {
      await this.options.ossStaging.delete(job.providerArtifactKey);
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
