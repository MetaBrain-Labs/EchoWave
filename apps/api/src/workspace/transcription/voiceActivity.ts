/**
 * Silero VAD 语音活动检测与时间轴恢复。
 *
 * 在有界内存中消费 16kHz 单声道 PCM16，生成可持久化的过滤清单，并把供应商返回的
 * 压缩时间轴安全映射回原始录音。
 *
 * Responsibilities:
 * - 驱动固定版本的 Silero ONNX 模型并提取语音区间。
 * - 按保守策略折叠超长非人声区间并生成审计清单。
 * - 拒绝跨越折叠边界或落入合成静音的转写时间范围。
 *
 * Notes:
 * - 本模块只接收 PCM，不负责音频解码或编码。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import * as ort from 'onnxruntime-node';
import { z } from 'zod';

import type { TranscriptDraft } from '../persistence/audioAnalysisRepository.ts';

export const SILERO_VAD_MODEL = 'silero-vad-v6.2.1' as const;
export const SILERO_VAD_MODEL_SHA256 =
  '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3' as const;

export const VOICE_ACTIVITY_POLICY = {
  sampleRate: 16_000,
  frameSamples: 512,
  startThreshold: 0.5,
  endThreshold: 0.35,
  minSpeechMs: 250,
  minSilenceMs: 100,
  speechPrePadMs: 400,
  speechPostPadMs: 600,
  collapseGapOverMs: 30_000,
  separatorMs: 2_000,
} as const;

const VoiceActivityPolicySchema = z.object({
  sampleRate: z.literal(VOICE_ACTIVITY_POLICY.sampleRate),
  frameSamples: z.literal(VOICE_ACTIVITY_POLICY.frameSamples),
  startThreshold: z.literal(VOICE_ACTIVITY_POLICY.startThreshold),
  endThreshold: z.literal(VOICE_ACTIVITY_POLICY.endThreshold),
  minSpeechMs: z.literal(VOICE_ACTIVITY_POLICY.minSpeechMs),
  minSilenceMs: z.literal(VOICE_ACTIVITY_POLICY.minSilenceMs),
  speechPrePadMs: z.literal(VOICE_ACTIVITY_POLICY.speechPrePadMs),
  speechPostPadMs: z.literal(VOICE_ACTIVITY_POLICY.speechPostPadMs),
  collapseGapOverMs: z.literal(VOICE_ACTIVITY_POLICY.collapseGapOverMs),
  separatorMs: z.literal(VOICE_ACTIVITY_POLICY.separatorMs),
});

export const VoiceActivityManifestSchema = z.object({
  version: z.literal(1),
  mode: z.literal('silero_vad'),
  model: z.literal(SILERO_VAD_MODEL),
  modelSha256: z.literal(SILERO_VAD_MODEL_SHA256),
  detectionDurationMs: z.number().int().nonnegative().default(0),
  originalDurationMs: z.number().int().positive(),
  processedDurationMs: z.number().int().positive(),
  skippedDurationMs: z.number().int().nonnegative(),
  policy: VoiceActivityPolicySchema,
  sourceSpans: z
    .array(
      z
        .object({
          originalStartMs: z.number().int().nonnegative(),
          originalEndMs: z.number().int().positive(),
          processedStartMs: z.number().int().nonnegative(),
          processedEndMs: z.number().int().positive(),
        })
        .refine(
          (span) =>
            span.originalEndMs > span.originalStartMs &&
            span.processedEndMs > span.processedStartMs &&
            span.originalEndMs - span.originalStartMs ===
              span.processedEndMs - span.processedStartMs,
          { message: 'VAD source span duration is invalid.' },
        ),
    )
    .min(1),
  skippedIntervals: z.array(
    z
      .object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
        reason: z.literal('silero_vad_non_speech'),
      })
      .refine((interval) => interval.endMs > interval.startMs, {
        message: 'VAD skipped interval is invalid.',
      }),
  ),
});

export type VoiceActivityManifest = z.infer<typeof VoiceActivityManifestSchema>;
export type SpeechSampleRange = { startSample: number; endSample: number };

type SessionLike = {
  run(feeds: Record<string, ort.Tensor>): Promise<Record<string, ort.Tensor>>;
};

type SessionFactory = (modelPath: string) => Promise<SessionLike>;

/** Silero 模型或过滤清单无法安全使用。 */
export class VoiceActivityError extends Error {
  constructor(
    public readonly code:
      | 'VAD_UNAVAILABLE'
      | 'VOICE_ACTIVITY_DETECTION_FAILED'
      | 'NO_SPEECH_DETECTED'
      | 'INVALID_VAD_TIMELINE',
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'VoiceActivityError';
  }
}

function samplesToMs(samples: number): number {
  return Math.round((samples * 1_000) / VOICE_ACTIVITY_POLICY.sampleRate);
}

function msToSamples(milliseconds: number): number {
  return Math.round((milliseconds * VOICE_ACTIVITY_POLICY.sampleRate) / 1_000);
}

/** 根据逐帧概率重建未经 padding 的 Silero 语音区间。 */
export function speechRangesFromProbabilities(
  probabilities: readonly number[],
  totalSamples: number,
): SpeechSampleRange[] {
  const collector = new SpeechRangeCollector();
  probabilities.forEach((probability, index) => collector.push(probability, index));
  return collector.finish(totalSamples);
}

class SpeechRangeCollector {
  private readonly ranges: SpeechSampleRange[] = [];
  private speechStart?: number;
  private pendingEnd?: number;

  push(probability: number, frameIndex: number): void {
    const frameStart = frameIndex * VOICE_ACTIVITY_POLICY.frameSamples;
    if (probability >= VOICE_ACTIVITY_POLICY.startThreshold) {
      this.pendingEnd = undefined;
      this.speechStart ??= frameStart;
      return;
    }
    if (this.speechStart === undefined) return;
    if (probability >= VOICE_ACTIVITY_POLICY.endThreshold) {
      this.pendingEnd = undefined;
      return;
    }
    this.pendingEnd ??= frameStart;
    if (
      frameStart + VOICE_ACTIVITY_POLICY.frameSamples - this.pendingEnd >=
      msToSamples(VOICE_ACTIVITY_POLICY.minSilenceMs)
    ) {
      this.ranges.push({ startSample: this.speechStart, endSample: this.pendingEnd });
      this.speechStart = undefined;
      this.pendingEnd = undefined;
    }
  }

  finish(totalSamples: number): SpeechSampleRange[] {
    if (this.speechStart !== undefined && this.speechStart < totalSamples) {
      this.ranges.push({ startSample: this.speechStart, endSample: totalSamples });
    }
    return this.ranges.map((range) => ({
      startSample: Math.min(range.startSample, totalSamples),
      endSample: Math.min(range.endSample, totalSamples),
    }));
  }
}

/** 把检测区间扩边、合并并转换为可跨进程恢复的过滤清单。 */
export function buildVoiceActivityManifest(
  speechRanges: readonly SpeechSampleRange[],
  totalSamples: number,
  detectionDurationMs = 0,
): VoiceActivityManifest {
  const originalDurationMs = samplesToMs(totalSamples);
  const minSpeechSamples = msToSamples(VOICE_ACTIVITY_POLICY.minSpeechMs);
  const padded = speechRanges
    .filter((range) => range.endSample - range.startSample >= minSpeechSamples)
    .map((range) => ({
      startMs: Math.max(0, samplesToMs(range.startSample) - VOICE_ACTIVITY_POLICY.speechPrePadMs),
      endMs: Math.min(
        originalDurationMs,
        samplesToMs(range.endSample) + VOICE_ACTIVITY_POLICY.speechPostPadMs,
      ),
    }));
  if (padded.length === 0) {
    throw new VoiceActivityError(
      'NO_SPEECH_DETECTED',
      '未检测到可转写的人声，已停止本次转写。',
      false,
    );
  }

  const retained: { startMs: number; endMs: number }[] = [];
  for (const range of padded) {
    const previous = retained.at(-1);
    if (previous && range.startMs - previous.endMs <= VOICE_ACTIVITY_POLICY.collapseGapOverMs) {
      previous.endMs = Math.max(previous.endMs, range.endMs);
    } else {
      retained.push({ ...range });
    }
  }
  if (retained[0]!.startMs <= VOICE_ACTIVITY_POLICY.collapseGapOverMs) retained[0]!.startMs = 0;
  if (originalDurationMs - retained.at(-1)!.endMs <= VOICE_ACTIVITY_POLICY.collapseGapOverMs) {
    retained.at(-1)!.endMs = originalDurationMs;
  }

  let processedCursorMs = 0;
  const sourceSpans = retained.map((range, index) => {
    if (index > 0) processedCursorMs += VOICE_ACTIVITY_POLICY.separatorMs;
    const durationMs = range.endMs - range.startMs;
    const span = {
      originalStartMs: range.startMs,
      originalEndMs: range.endMs,
      processedStartMs: processedCursorMs,
      processedEndMs: processedCursorMs + durationMs,
    };
    processedCursorMs += durationMs;
    return span;
  });

  const skippedIntervals: VoiceActivityManifest['skippedIntervals'] = [];
  let originalCursorMs = 0;
  for (const span of sourceSpans) {
    if (span.originalStartMs > originalCursorMs) {
      skippedIntervals.push({
        startMs: originalCursorMs,
        endMs: span.originalStartMs,
        reason: 'silero_vad_non_speech',
      });
    }
    originalCursorMs = span.originalEndMs;
  }
  if (originalCursorMs < originalDurationMs) {
    skippedIntervals.push({
      startMs: originalCursorMs,
      endMs: originalDurationMs,
      reason: 'silero_vad_non_speech',
    });
  }

  return VoiceActivityManifestSchema.parse({
    version: 1,
    mode: 'silero_vad',
    model: SILERO_VAD_MODEL,
    modelSha256: SILERO_VAD_MODEL_SHA256,
    detectionDurationMs,
    originalDurationMs,
    processedDurationMs: processedCursorMs,
    skippedDurationMs: skippedIntervals.reduce(
      (sum, interval) => sum + interval.endMs - interval.startMs,
      0,
    ),
    policy: VOICE_ACTIVITY_POLICY,
    sourceSpans,
    skippedIntervals,
  });
}

/** 把压缩时间轴上的转写段恢复到原录音，并拒绝跨折叠边界的模糊结果。 */
export function restoreOriginalTimeline(
  segments: readonly TranscriptDraft[],
  manifest: VoiceActivityManifest,
): TranscriptDraft[] {
  return segments.map((segment) => {
    const overlaps = manifest.sourceSpans.filter(
      (span) => segment.endMs > span.processedStartMs && segment.startMs < span.processedEndMs,
    );
    if (overlaps.length !== 1) {
      throw new VoiceActivityError(
        'INVALID_VAD_TIMELINE',
        '转写结果跨越了空闲音频过滤边界，请重试。',
        true,
      );
    }
    const span = overlaps[0]!;
    const processedStartMs = Math.max(segment.startMs, span.processedStartMs);
    const processedEndMs = Math.min(segment.endMs, span.processedEndMs);
    const startMs = span.originalStartMs + processedStartMs - span.processedStartMs;
    const endMs = span.originalStartMs + processedEndMs - span.processedStartMs;
    if (endMs <= startMs) {
      throw new VoiceActivityError(
        'INVALID_VAD_TIMELINE',
        '转写结果落入了空闲音频过滤边界，请重试。',
        true,
      );
    }
    return { ...segment, startMs, endMs };
  });
}

/** 固定版本 Silero ONNX 检测器。 */
export class SileroVoiceActivityDetector {
  private session?: SessionLike;

  constructor(
    private readonly modelPath: string,
    private readonly sessionFactory: SessionFactory = (path) =>
      ort.InferenceSession.create(path, {
        executionProviders: ['cpu'],
        interOpNumThreads: 1,
        intraOpNumThreads: 1,
      }),
  ) {}

  /** 校验模型来源并创建可复用的 CPU 推理会话。 */
  async verify(): Promise<void> {
    if (this.session) return;
    try {
      const bytes = await readFile(this.modelPath);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== SILERO_VAD_MODEL_SHA256) throw new Error('model checksum mismatch');
      this.session = await this.sessionFactory(this.modelPath);
    } catch {
      this.session = undefined;
      throw new VoiceActivityError(
        'VAD_UNAVAILABLE',
        'Silero VAD 模型不可用，请检查服务端模型资产。',
        true,
      );
    }
  }

  /** 流式读取 PCM16，并以固定 512 samples 帧执行状态化推理。 */
  async detect(pcm: AsyncIterable<Buffer>): Promise<VoiceActivityManifest> {
    const session = this.session;
    if (!session) {
      throw new VoiceActivityError('VAD_UNAVAILABLE', 'Silero VAD 当前不可用。', true);
    }

    const collector = new SpeechRangeCollector();
    let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let totalSamples = 0;
    let state: Float32Array<ArrayBufferLike> = new Float32Array(2 * 1 * 128);
    let context: Float32Array<ArrayBufferLike> = new Float32Array(64);
    const detectionStartedAt = Date.now();
    try {
      for await (const chunk of pcm) {
        pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
        const frameBytes = VOICE_ACTIVITY_POLICY.frameSamples * 2;
        while (pending.length >= frameBytes) {
          const frame = pending.subarray(0, frameBytes);
          pending = pending.subarray(frameBytes);
          const result = await this.inferFrame(session, frame, context, state);
          collector.push(
            result.probability,
            Math.floor(totalSamples / VOICE_ACTIVITY_POLICY.frameSamples),
          );
          context = result.context;
          state = result.state;
          totalSamples += VOICE_ACTIVITY_POLICY.frameSamples;
        }
      }
      if (pending.length > 0) {
        const actualSamples = Math.floor(pending.length / 2);
        const padded = Buffer.alloc(VOICE_ACTIVITY_POLICY.frameSamples * 2);
        pending.copy(padded, 0, 0, actualSamples * 2);
        const result = await this.inferFrame(session, padded, context, state);
        collector.push(
          result.probability,
          Math.floor(totalSamples / VOICE_ACTIVITY_POLICY.frameSamples),
        );
        totalSamples += actualSamples;
      }
      return buildVoiceActivityManifest(
        collector.finish(totalSamples),
        totalSamples,
        Date.now() - detectionStartedAt,
      );
    } catch (error) {
      if (error instanceof VoiceActivityError) throw error;
      throw new VoiceActivityError(
        'VOICE_ACTIVITY_DETECTION_FAILED',
        '空闲音频检测失败，请稍后重试。',
        true,
      );
    }
  }

  private async inferFrame(
    session: SessionLike,
    frame: Buffer,
    context: Float32Array,
    state: Float32Array,
  ): Promise<{ probability: number; context: Float32Array; state: Float32Array }> {
    const input = new Float32Array(context.length + VOICE_ACTIVITY_POLICY.frameSamples);
    input.set(context);
    for (let index = 0; index < VOICE_ACTIVITY_POLICY.frameSamples; index += 1) {
      input[context.length + index] = frame.readInt16LE(index * 2) / 32_768;
    }
    const result = await session.run({
      input: new ort.Tensor('float32', input, [1, input.length]),
      state: new ort.Tensor('float32', state, [2, 1, 128]),
      sr: new ort.Tensor(
        'int64',
        BigInt64Array.from([BigInt(VOICE_ACTIVITY_POLICY.sampleRate)]),
        [1],
      ),
    });
    const output = result.output;
    const nextState = result.stateN;
    if (!output || !nextState || typeof output.data[0] !== 'number') {
      throw new Error('invalid Silero output');
    }
    return {
      probability: output.data[0],
      context: input.slice(-64),
      state: Float32Array.from(nextState.data as Float32Array),
    };
  }
}
