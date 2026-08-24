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
  chunks: Annotation<AudioChunk[]>(),
  segments: Annotation<TranscriptDraft[]>(),
});

type WorkerOptions = {
  asr: OpenRouterAsr;
  preprocessor: AudioInputPreprocessor;
  repository: AudioAnalysisRepository;
};

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
      .addNode('preprocess', async ({ job }) => {
        await options.repository.setProgress(job, 5);
        return { chunks: await options.preprocessor.createChunks(job) };
      })
      .addNode('transcribe', async ({ chunks, job }) => {
        const results: {
          chunk: AudioChunk;
          result: Awaited<ReturnType<OpenRouterAsr['transcribeChunk']>>;
        }[] = [];
        const knownSpeakers = new Map<string, AsrSpeaker>();
        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index]!;
          const result = await options.asr.transcribeChunk({
            audioPath: chunk.path,
            durationMs: chunk.durationMs,
            format: chunk.format,
            knownSpeakers: [...knownSpeakers.values()],
            preprocessingMode: job.preprocessingMode,
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
        return { segments: mergeChunkSegments(results, job.durationMs) };
      })
      .addNode('publish', async ({ job, segments }) => {
        await options.repository.setProgress(job, 95);
        await options.repository.publishTranscription(job, segments);
        return {};
      })
      .addNode('cleanup', async ({ job }) => {
        await options.preprocessor.cleanup(job);
        return {};
      })
      .addEdge(START, 'preprocess')
      .addEdge('preprocess', 'transcribe')
      .addEdge('transcribe', 'publish')
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
    try {
      await this.graph.invoke({ job });
      console.info('Audio transcription completed', {
        audioFileId: job.audioFileId,
        durationMs: Date.now() - startedAt,
        revisionId: job.revisionId,
      });
    } catch (error) {
      const known =
        error instanceof AudioPreprocessingError ||
        error instanceof AudioTranscriptionProviderError;
      const code = known ? error.code : 'INTERNAL_ERROR';
      const message = known ? error.message : '音频转写失败，请稍后重试。';
      const retryable = known ? error.retryable : true;
      const providerHttpStatus =
        error instanceof AudioTranscriptionProviderError ? error.providerHttpStatus : undefined;
      await this.options.repository.failTranscription(job, code, message, retryable);
      await this.options.preprocessor.cleanup(job).catch(() => undefined);
      console.error('Audio transcription failed', {
        audioFileId: job.audioFileId,
        code,
        ...(providerHttpStatus === undefined ? {} : { providerHttpStatus }),
        revisionId: job.revisionId,
        retryable,
      });
    }
  }
}
