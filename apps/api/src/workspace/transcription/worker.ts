/**
 * 音频 ASR 后台 worker。
 *
 * 通过显式 LangGraph 流程顺序完成转码分块、Gemini 转写、结果合并、原子发布和
 * 临时文件清理；当前与 API 同进程并保持单并发。
 *
 * Responsibilities:
 * - 周期领取 PostgreSQL 中排队的音频修订。
 * - 规范化跨分块 Speaker、角色、时间戳和重叠文本。
 * - 将失败安全收敛到当前修订并保留旧结果。
 *
 * Notes:
 * - 当前本地文件存储只支持单 API 实例，启动时会重新排队中断任务。
 */
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { AudioFailureDetails } from '@echowave/contracts';

import {
  noOpAiExecutionReporter,
  type AiExecutionRecorder,
  type AiExecutionReporter,
} from '../../ai-observability/executionReporter.ts';

import type {
  ClaimedAudioTranscription,
  TranscriptDraft,
} from '../persistence/audioAnalysisRepository.ts';
import { AudioAnalysisRepository } from '../persistence/audioAnalysisRepository.ts';
import {
  AudioPreprocessingError,
  AudioInputPreprocessor,
  type AudioChunk,
} from './audioPreprocessor.ts';
import {
  AudioTranscriptionProviderError,
  OpenRouterAsr,
  type AsrSpeaker,
} from './openRouterAsr.ts';

const TranscriptionState = Annotation.Root({
  job: Annotation<ClaimedAudioTranscription>(),
  report: Annotation<AiExecutionRecorder>(),
  chunks: Annotation<AudioChunk[]>(),
  chunkResults: Annotation<ChunkResult[]>(),
  segments: Annotation<TranscriptDraft[]>(),
});

type ChunkResult = {
  chunk: AudioChunk;
  result: Awaited<ReturnType<OpenRouterAsr['transcribeChunk']>>;
};

type WorkerOptions = {
  asr: OpenRouterAsr;
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

function textSimilarity(left: string, right: string): number {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.length === 1 || normalizedRight.length === 1) return 0;
  const bigrams = (value: string) => {
    const result = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const bigram = value.slice(index, index + 2);
      result.set(bigram, (result.get(bigram) ?? 0) + 1);
    }
    return result;
  };
  const leftBigrams = bigrams(normalizedLeft);
  const rightBigrams = bigrams(normalizedRight);
  let intersection = 0;
  for (const [bigram, count] of leftBigrams) {
    intersection += Math.min(count, rightBigrams.get(bigram) ?? 0);
  }
  return (2 * intersection) / (normalizedLeft.length + normalizedRight.length - 2);
}

function deduplicateOverlaps(segments: TranscriptDraft[]): TranscriptDraft[] {
  const deduplicated: TranscriptDraft[] = [];
  for (const segment of segments) {
    let duplicateIndex = -1;
    for (let index = deduplicated.length - 1; index >= 0; index -= 1) {
      const candidate = deduplicated[index]!;
      if (candidate.endMs <= segment.startMs) continue;
      const overlap = Math.min(candidate.endMs, segment.endMs) - segment.startMs;
      const shorterDuration = Math.min(
        candidate.endMs - candidate.startMs,
        segment.endMs - segment.startMs,
      );
      if (
        candidate.speakerKey === segment.speakerKey &&
        overlap / shorterDuration >= 0.35 &&
        textSimilarity(candidate.text, segment.text) >= 0.8
      ) {
        duplicateIndex = index;
        break;
      }
    }
    if (duplicateIndex < 0) {
      deduplicated.push(segment);
    } else if (segment.text.length > deduplicated[duplicateIndex]!.text.length) {
      deduplicated[duplicateIndex] = segment;
    }
  }
  return deduplicated;
}

/** 合并顺序分块并用主区间中点规则去除两秒重叠产生的重复内容。 */
export function mergeChunkSegments(
  chunks: {
    chunk: AudioChunk;
    result: Awaited<ReturnType<OpenRouterAsr['transcribeChunk']>>;
  }[],
  durationMs: number,
): TranscriptDraft[] {
  const roles = new Map<string, string>();
  for (const { result } of chunks) {
    for (const speaker of result.speakers) {
      const current = roles.get(speaker.speakerKey);
      if (!current || (current === 'unknown' && speaker.businessRole !== 'unknown')) {
        roles.set(speaker.speakerKey, speaker.businessRole);
      }
    }
  }
  const selected = chunks.flatMap(({ chunk, result }) =>
    result.segments.flatMap((segment) => {
      const startMs = Math.max(0, chunk.offsetMs + segment.startMs);
      const endMs = Math.min(durationMs, chunk.offsetMs + segment.endMs);
      const midpoint = (startMs + endMs) / 2;
      if (endMs <= startMs || midpoint < chunk.primaryStartMs || midpoint >= chunk.primaryEndMs) {
        return [];
      }
      return [
        {
          businessRole: roles.get(segment.speakerKey) ?? 'unknown',
          emotion: segment.emotion,
          endMs,
          speakerKey: segment.speakerKey,
          startMs,
          text: segment.text.trim(),
        },
      ];
    }),
  );
  selected.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const deduplicated = deduplicateOverlaps(selected);
  const canonical = new Map<string, string>();
  for (const segment of deduplicated) {
    if (!canonical.has(segment.speakerKey)) {
      canonical.set(segment.speakerKey, `Speaker ${canonical.size}`);
    }
    segment.speakerKey = canonical.get(segment.speakerKey)!;
  }
  return deduplicated;
}

/** 管理音频任务领取、显式工作流执行和优雅停止。 */
export class AudioTranscriptionWorker {
  private active?: Promise<void>;
  private pumping = false;
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private readonly graph;

  constructor(private readonly options: WorkerOptions) {
    this.graph = new StateGraph(TranscriptionState)
      .addNode('preprocess', async ({ job, report }) => {
        let chunks: AudioChunk[];
        try {
          chunks = await reportedStep(
            report,
            'preprocess',
            async () => {
              await options.repository.setProgress(job, 5);
              return options.preprocessor.createChunks(job);
            },
            (value) => ({
              progress: 5,
              preprocessingMode: job.preprocessingMode,
              inputMimeType: job.mimeType,
              chunkCount: value.length,
              outputFormat: value[0]?.format ?? null,
              overlapMs: job.preprocessingMode === 'ffmpeg' ? 2_000 : 0,
              chunks: value.map((chunk, index) => ({
                index: index + 1,
                durationMs: chunk.durationMs,
                offsetMs: chunk.offsetMs,
                primaryStartMs: chunk.primaryStartMs,
                primaryEndMs: chunk.primaryEndMs,
              })),
            }),
          );
        } catch (error) {
          if (job.preprocessingMode === 'ffmpeg') {
            report.recordToolCall({
              name: 'ffmpeg-preprocess',
              status: 'failed',
              summary: {
                reason: error instanceof AudioPreprocessingError ? error.code : 'internal_error',
              },
            });
          }
          throw error;
        }
        if (job.preprocessingMode === 'ffmpeg') {
          report.recordToolCall({
            name: 'ffmpeg-preprocess',
            status: 'completed',
            summary: { chunkCount: chunks.length, outputFormat: 'mp3' },
          });
        }
        return { chunks };
      })
      .addNode('transcribe', async ({ chunks, job, report }) => {
        const chunkResults = await reportedStep(
          report,
          'transcribe',
          async () => {
            const results: ChunkResult[] = [];
            const knownSpeakers = new Map<string, AsrSpeaker>();
            for (let index = 0; index < chunks.length; index += 1) {
              const chunk = chunks[index]!;
              const result = await options.asr.transcribeChunk({
                audioPath: chunk.path,
                chunkCount: chunks.length,
                chunkIndex: index + 1,
                durationMs: chunk.durationMs,
                format: chunk.format,
                knownSpeakers: [...knownSpeakers.values()],
                preprocessingMode: job.preprocessingMode,
                report,
              });
              for (const speaker of result.speakers) {
                const current = knownSpeakers.get(speaker.speakerKey);
                if (
                  !current ||
                  (current.businessRole === 'unknown' && speaker.businessRole !== 'unknown')
                ) {
                  knownSpeakers.set(speaker.speakerKey, speaker);
                }
              }
              results.push({ chunk, result });
              await options.repository.setProgress(job, 10 + ((index + 1) / chunks.length) * 80);
            }
            return results;
          },
          (value) => ({
            progress: 90,
            chunkCount: value.length,
            modelSegmentCount: value.reduce(
              (total, item) => total + item.result.segments.length,
              0,
            ),
          }),
        );
        return { chunkResults };
      })
      .addNode('validate-merge', async ({ chunkResults, job, report }) => {
        const modelSegmentCount = chunkResults.reduce(
          (total, item) => total + item.result.segments.length,
          0,
        );
        const segments = await reportedStep(
          report,
          'validate-merge',
          async () => mergeChunkSegments(chunkResults, job.durationMs),
          (value) => ({
            progress: 90,
            modelSegmentCount,
            finalSegmentCount: value.length,
            deduplicatedCount: Math.max(0, modelSegmentCount - value.length),
            speakerCount: new Set(value.map((segment) => segment.speakerKey)).size,
            businessRoles: Object.fromEntries(
              [...new Set(value.map((segment) => segment.businessRole))].map((role) => [
                role,
                value.filter((segment) => segment.businessRole === role).length,
              ]),
            ),
            emotions: Object.fromEntries(
              [...new Set(value.map((segment) => segment.emotion))].map((emotion) => [
                emotion,
                value.filter((segment) => segment.emotion === emotion).length,
              ]),
            ),
          }),
        );
        return { segments };
      })
      .addNode('publish', async ({ job, segments, report }) => {
        await reportedStep(
          report,
          'publish',
          async () => {
            await options.repository.setProgress(job, 95);
            await options.repository.publishTranscription(job, segments);
          },
          () => ({ progress: 100, segmentCount: segments.length }),
        );
        return {};
      })
      .addNode('cleanup', async ({ job, report }) => {
        await reportedStep(
          report,
          'cleanup',
          () => options.preprocessor.cleanup(job),
          () => ({ progress: 100 }),
        );
        return {};
      })
      .addEdge(START, 'preprocess')
      .addEdge('preprocess', 'transcribe')
      .addEdge('transcribe', 'validate-merge')
      .addEdge('validate-merge', 'publish')
      .addEdge('publish', 'cleanup')
      .addEdge('cleanup', END)
      .compile();
  }

  /** 重新排队中断任务后启动周期领取；重复调用不会创建第二个 timer。 */
  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    await this.options.repository.resetInterruptedTranscriptions();
    this.timer = setInterval(() => void this.pump(), 750);
    this.timer.unref();
    void this.pump();
  }

  /** 停止领取新任务并等待当前模型调用安全收敛。 */
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
        source: {
          dataSource: job.dataSource,
          ingestionRunId: job.ingestionRunId,
        },
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
        },
      },
    });
    try {
      const result = await this.graph.invoke({ job, report });
      const durationMs = Date.now() - startedAt;
      await report.finish({
        status: 'completed',
        metadata: {
          durationMs,
          chunkCount: result.chunks.length,
          segmentCount: result.segments.length,
          speakerCount: new Set(result.segments.map((segment) => segment.speakerKey)).size,
        },
      });
      console.info('Audio transcription completed', {
        audioFileId: job.audioFileId,
        durationMs,
        revisionId: job.revisionId,
      });
    } catch (error) {
      const known =
        error instanceof AudioPreprocessingError ||
        error instanceof AudioTranscriptionProviderError;
      const code = known ? error.code : 'INTERNAL_ERROR';
      const message = known ? error.message : '音频转写失败，请稍后重试。';
      const retryable = known ? error.retryable : true;
      const details = failureDetails(error);
      const providerHttpStatus =
        error instanceof AudioTranscriptionProviderError ? error.providerHttpStatus : undefined;
      const persistenceStartedAt = Date.now();
      report.recordStep({ name: 'persist-failure', status: 'started' });
      let persistenceError: unknown;
      try {
        await this.options.repository.failTranscription(job, code, message, retryable, details);
        report.recordStep({
          name: 'persist-failure',
          status: 'completed',
          durationMs: Date.now() - persistenceStartedAt,
        });
      } catch (reason) {
        persistenceError = reason;
        report.recordStep({
          name: 'persist-failure',
          status: 'failed',
          durationMs: Date.now() - persistenceStartedAt,
        });
      }
      const cleanupStartedAt = Date.now();
      report.recordStep({ name: 'cleanup-failure', status: 'started' });
      try {
        await this.options.preprocessor.cleanup(job);
        report.recordStep({
          name: 'cleanup-failure',
          status: 'completed',
          durationMs: Date.now() - cleanupStartedAt,
        });
      } catch {
        report.recordStep({
          name: 'cleanup-failure',
          status: 'failed',
          durationMs: Date.now() - cleanupStartedAt,
        });
      }
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
        ...(providerHttpStatus === undefined ? {} : { providerHttpStatus }),
        revisionId: job.revisionId,
        retryable,
      });
      if (persistenceError) throw persistenceError;
    }
  }
}
