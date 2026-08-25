/**
 * OpenRouter 多模型 STT 适配器。
 *
 * 通过 OpenRouter Audio Transcriptions 接口发送单个音频块，并把不同供应商的
 * words、segments 或纯文本响应归一为工作区既有的转写片段。
 *
 * Responsibilities:
 * - 对临时网络错误执行有限重试，并让安全错误立即失败。
 * - 校验时间戳边界、文本密度和重复循环，不记录音频或完整正文。
 * - 仅映射供应商实际返回的 Speaker 与时间戳能力。
 *
 * Notes:
 * - 业务角色与情绪不是 STT 能力，始终输出 unknown。
 */
import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import type {
  AudioFailureDetails,
  AudioFailureIssue,
  AudioTranscriptionDirectFormat,
  AudioTranscriptionModel,
  AudioTranscriptionPreprocessing,
} from '@echowave/contracts';

import type { AiExecutionRecorder } from '../../ai-observability/executionReporter.ts';
import { analyzeTranscriptQuality, type TranscriptQualityMetrics } from './transcriptQuality.ts';

const MAX_NETWORK_ATTEMPTS = 3;
const SPEAKER_BREAK_MS = 750;
const TERMINAL_PUNCTUATION = /[。！？.!?]$/u;

const UsageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
    seconds: z.number().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
  })
  .passthrough();
const TimedItemSchema = z
  .object({
    text: z.string().optional(),
    word: z.string().optional(),
    start: z.number(),
    end: z.number(),
    speaker: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();
const ChannelSchema = z
  .object({
    words: z.array(TimedItemSchema).optional(),
    segments: z.array(TimedItemSchema).optional(),
  })
  .passthrough();
const OpenRouterSttResponseSchema = z
  .object({
    text: z.string().default(''),
    language: z.string().optional(),
    duration: z.number().nonnegative().optional(),
    words: z.array(TimedItemSchema).optional(),
    segments: z.array(TimedItemSchema).optional(),
    channels: z.array(ChannelSchema).optional(),
    usage: UsageSchema.optional(),
    provider: z.string().optional(),
  })
  .passthrough();
type TimedItem = z.infer<typeof TimedItemSchema>;

/** 单个 Speaker 的兼容输出；业务角色不会由正文推断。 */
export type SttSpeaker = { speakerKey: string; businessRole: 'unknown' };

/** 单个音频块经过归一化与安全校验后的输出。 */
export type SttChunkResult = {
  speakers: SttSpeaker[];
  segments: {
    speakerKey: string;
    businessRole: 'unknown';
    emotion: 'unknown';
    startMs: number;
    endMs: number;
    text: string;
  }[];
  language?: string;
  providerDurationMs?: number;
  usage?: z.infer<typeof UsageSchema>;
  generationId?: string;
  qualityMetrics: TranscriptQualityMetrics;
};

/** OpenRouter STT 调用失败的稳定错误。 */
export class AudioTranscriptionProviderError extends Error {
  constructor(
    public readonly code:
      'DIRECT_AUDIO_REJECTED' | 'INVALID_MODEL_OUTPUT' | 'MODEL_TIMEOUT' | 'MODEL_UNAVAILABLE',
    message: string,
    public readonly retryable = true,
    public readonly providerHttpStatus?: number,
    public readonly details: AudioFailureDetails | null = null,
  ) {
    super(message);
    this.name = 'AudioTranscriptionProviderError';
  }
}

/** 当前块应由 Worker 拆小后重试，且不会触发跨模型切换。 */
export class AudioTranscriptionSplitRequiredError extends AudioTranscriptionProviderError {
  constructor(
    code: 'INVALID_MODEL_OUTPUT' | 'MODEL_TIMEOUT',
    message: string,
    details: AudioFailureDetails,
    public readonly reason: 'quality_degradation' | 'timeout',
    public readonly qualityMetrics?: TranscriptQualityMetrics,
  ) {
    super(code, message, true, undefined, details);
    this.name = 'AudioTranscriptionSplitRequiredError';
  }
}

function diagnosticDetails(
  category: AudioFailureDetails['category'],
  chunkIndex: number,
  chunkCount: number,
  issues: AudioFailureIssue[],
): AudioFailureDetails {
  return {
    category,
    chunkIndex,
    chunkCount,
    structureAttempts: 0,
    issues: issues.slice(0, 20),
    outputLength: null,
    outputSha256: null,
  };
}

function safeProviderIssue(status: number): AudioFailureIssue {
  const code =
    status === 401
      ? 'provider_authentication_failed'
      : status === 402
        ? 'provider_quota_exhausted'
        : status === 403
          ? 'provider_permission_denied'
          : status === 429
            ? 'provider_rate_limited'
            : status >= 500
              ? 'provider_unavailable'
              : 'provider_invalid_request';
  return { path: '$', code, message: `转写服务请求失败（HTTP ${status}）。` };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function joinWords(words: string[]): string {
  return words
    .map((word) => word.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;:!?，。；：！？])/gu, '$1')
    .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1');
}

function itemText(item: TimedItem): string {
  return (item.text ?? item.word ?? '').trim();
}

function timestampIssues(items: TimedItem[], durationMs: number): AudioFailureIssue[] {
  const issues: AudioFailureIssue[] = [];
  let previousStartMs = -1;
  for (const [index, item] of items.entries()) {
    const startMs = Math.round(item.start * 1_000);
    const endMs = Math.round(item.end * 1_000);
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs < 0 ||
      endMs <= startMs ||
      endMs > durationMs + 1_000
    ) {
      issues.push({
        path: `timestamps.${index}`,
        code: 'invalid_timestamp_range',
        message: '转写服务返回了越界或无效时间戳。',
      });
    } else if (startMs < previousStartMs) {
      issues.push({
        path: `timestamps.${index}.start`,
        code: 'timestamps_out_of_order',
        message: '转写服务返回的时间戳顺序无效。',
      });
    }
    previousStartMs = startMs;
  }
  return issues;
}

function normalizeSpeaker(value: string | number | undefined, channelIndex = 0): string {
  return value === undefined ? `channel:${channelIndex}:speaker:0` : `speaker:${String(value)}`;
}

function timedItemsFromResponse(response: z.infer<typeof OpenRouterSttResponseSchema>): {
  kind: 'word' | 'segment';
  items: (TimedItem & { channelIndex?: number })[];
} | null {
  if (response.words?.length) return { kind: 'word', items: response.words };
  const channelWords = response.channels?.flatMap((channel, channelIndex) =>
    (channel.words ?? []).map((word) => ({ ...word, channelIndex })),
  );
  if (channelWords?.length) {
    channelWords.sort((left, right) => left.start - right.start || left.end - right.end);
    return { kind: 'word', items: channelWords };
  }
  if (response.segments?.length) return { kind: 'segment', items: response.segments };
  const channelSegments = response.channels?.flatMap((channel, channelIndex) =>
    (channel.segments ?? []).map((segment) => ({ ...segment, channelIndex })),
  );
  channelSegments?.sort((left, right) => left.start - right.start || left.end - right.end);
  return channelSegments?.length ? { kind: 'segment', items: channelSegments } : null;
}

/** 把供应商可选 words、segments 或 text 归一为既有片段。 */
export function normalizeSttResponse(
  payload: unknown,
  durationMs: number,
  chunkIndex = 1,
  chunkCount = 1,
): SttChunkResult {
  const parsed = OpenRouterSttResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AudioTranscriptionProviderError(
      'INVALID_MODEL_OUTPUT',
      '转写服务返回了无效响应。',
      true,
      undefined,
      diagnosticDetails('schema_validation', chunkIndex, chunkCount, [
        { path: '$', code: 'invalid_response_envelope', message: '响应结构不符合 STT 契约。' },
      ]),
    );
  }
  const response = parsed.data;
  const timed = timedItemsFromResponse(response);
  if (!timed) {
    const text = response.text.trim();
    const segments: SttChunkResult['segments'] = text
      ? [
          {
            speakerKey: 'Speaker 0',
            businessRole: 'unknown',
            emotion: 'unknown',
            startMs: 0,
            endMs: durationMs,
            text,
          },
        ]
      : [];
    const quality = analyzeTranscriptQuality(segments, durationMs);
    if (quality.issues.length) {
      throw new AudioTranscriptionSplitRequiredError(
        'INVALID_MODEL_OUTPUT',
        '当前音频块的转写正文出现明显退化。',
        diagnosticDetails('semantic_validation', chunkIndex, chunkCount, quality.issues),
        'quality_degradation',
        quality.metrics,
      );
    }
    return {
      speakers: text ? [{ speakerKey: 'Speaker 0', businessRole: 'unknown' }] : [],
      segments,
      ...(response.language ? { language: response.language } : {}),
      ...(response.duration !== undefined
        ? { providerDurationMs: Math.round(response.duration * 1_000) }
        : {}),
      ...(response.usage ? { usage: response.usage } : {}),
      qualityMetrics: quality.metrics,
    };
  }

  const issues = timestampIssues(timed.items, durationMs);
  if (issues.length) {
    throw new AudioTranscriptionProviderError(
      'INVALID_MODEL_OUTPUT',
      '转写服务返回了无效时间戳。',
      true,
      undefined,
      diagnosticDetails('semantic_validation', chunkIndex, chunkCount, issues),
    );
  }
  const speakerNames = new Map<string, string>();
  const speakerName = (raw: string) => {
    if (!speakerNames.has(raw)) speakerNames.set(raw, `Speaker ${speakerNames.size}`);
    return speakerNames.get(raw)!;
  };
  const segments: SttChunkResult['segments'] = [];
  for (const item of timed.items) {
    const text = itemText(item);
    if (!text) continue;
    const rawSpeaker = normalizeSpeaker(item.speaker, item.channelIndex);
    const speakerKey = speakerName(rawSpeaker);
    const startMs = Math.max(0, Math.round(item.start * 1_000));
    const endMs = Math.min(durationMs, Math.round(item.end * 1_000));
    const previous = segments.at(-1);
    const shouldMerge =
      timed.kind === 'word' &&
      previous !== undefined &&
      previous.speakerKey === speakerKey &&
      startMs - previous.endMs <= SPEAKER_BREAK_MS &&
      !TERMINAL_PUNCTUATION.test(previous.text);
    if (shouldMerge) {
      previous.endMs = endMs;
      previous.text = joinWords([previous.text, text]);
    } else {
      segments.push({
        speakerKey,
        businessRole: 'unknown',
        emotion: 'unknown',
        startMs,
        endMs,
        text,
      });
    }
  }
  const quality = analyzeTranscriptQuality(segments, durationMs, segments.length);
  if (quality.issues.length) {
    const details = diagnosticDetails(
      'semantic_validation',
      chunkIndex,
      chunkCount,
      quality.issues,
    );
    throw new AudioTranscriptionSplitRequiredError(
      'INVALID_MODEL_OUTPUT',
      '当前音频块的转写正文出现明显退化。',
      details,
      'quality_degradation',
      quality.metrics,
    );
  }
  return {
    speakers: [...speakerNames.values()].map((speakerKey) => ({
      speakerKey,
      businessRole: 'unknown',
    })),
    segments,
    ...(response.language ? { language: response.language } : {}),
    ...(response.duration !== undefined
      ? { providerDurationMs: Math.round(response.duration * 1_000) }
      : {}),
    ...(response.usage ? { usage: response.usage } : {}),
    qualityMetrics: quality.metrics,
  };
}

/** 通过 OpenRouter 调用用户为本次修订选定的 STT 模型。 */
export class OpenRouterStt {
  private readonly fetchImplementation: typeof fetch;

  constructor(
    private readonly options: {
      apiKey: string;
      fetchImplementation?: typeof fetch;
      requestTimeoutMs?: number;
    },
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  /** 转写一个音频块；网络重试不改变模型，任务也不会自动故障转移。 */
  async transcribeChunk(input: {
    audioPath: string;
    chunkCount: number;
    chunkIndex: number;
    durationMs: number;
    format: AudioTranscriptionDirectFormat;
    model: AudioTranscriptionModel;
    preprocessingMode: AudioTranscriptionPreprocessing;
    report?: AiExecutionRecorder;
    onActivity?: (activity: {
      stage: 'transcribing' | 'validating';
      networkAttempt: number | null;
    }) => Promise<void>;
  }): Promise<SttChunkResult> {
    const audio = await readFile(input.audioPath);
    for (let attempt = 1; attempt <= MAX_NETWORK_ATTEMPTS; attempt += 1) {
      await input.onActivity?.({ stage: 'transcribing', networkAttempt: attempt });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.requestTimeoutMs ?? 60_000);
      const startedAt = Date.now();
      try {
        const response = await this.fetchImplementation(
          'https://openrouter.ai/api/v1/audio/transcriptions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.options.apiKey}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: input.model,
              input_audio: { data: audio.toString('base64'), format: input.format },
              ...(input.model === 'x-ai/grok-stt-1.0'
                ? { provider: { options: { xai: { diarize: true } } } }
                : {}),
              ...(input.model === 'openai/whisper-large-v3'
                ? { response_format: 'verbose_json', timestamp_granularities: ['word'] }
                : input.model === 'openai/gpt-transcribe'
                  ? { response_format: 'verbose_json', timestamp_granularities: ['segment'] }
                  : {}),
            }),
          },
        );
        if (!response.ok) {
          await response.json().catch(() => undefined);
          const issue = safeProviderIssue(response.status);
          input.report?.recordModelCall({
            name: 'audio-transcription-chunk',
            provider: 'OpenRouter STT',
            model: input.model,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            metadata: {
              chunkIndex: input.chunkIndex,
              chunkCount: input.chunkCount,
              networkAttempt: attempt,
              providerHttpStatus: response.status,
              reason: issue.code,
            },
          });
          if (isRetryableStatus(response.status) && attempt < MAX_NETWORK_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
            continue;
          }
          const directRejected =
            input.preprocessingMode === 'direct' && [400, 413, 415, 422].includes(response.status);
          throw new AudioTranscriptionProviderError(
            directRejected ? 'DIRECT_AUDIO_REJECTED' : 'MODEL_UNAVAILABLE',
            directRejected
              ? '原音频被转写服务拒绝，请启用 FFmpeg 预处理后重试。'
              : '所选转写模型当前不可用，请稍后重试或重新选择模型。',
            isRetryableStatus(response.status),
            response.status,
            diagnosticDetails('provider', input.chunkIndex, input.chunkCount, [issue]),
          );
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          input.report?.recordModelCall({
            name: 'audio-transcription-chunk',
            provider: 'OpenRouter STT',
            model: input.model,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            metadata: {
              chunkIndex: input.chunkIndex,
              chunkCount: input.chunkCount,
              networkAttempt: attempt,
              reason: 'invalid_response_json',
            },
          });
          throw new AudioTranscriptionProviderError(
            'INVALID_MODEL_OUTPUT',
            '转写服务返回了无法解析的响应。',
            true,
            undefined,
            diagnosticDetails('invalid_json', input.chunkIndex, input.chunkCount, [
              { path: '$', code: 'invalid_response_json', message: '响应不是有效 JSON。' },
            ]),
          );
        }
        await input.onActivity?.({ stage: 'validating', networkAttempt: null });
        const generationId =
          response.headers.get('x-generation-id') ??
          response.headers.get('x-openrouter-generation-id');
        let result: SttChunkResult;
        try {
          result = normalizeSttResponse(
            payload,
            input.durationMs,
            input.chunkIndex,
            input.chunkCount,
          );
        } catch (error) {
          input.report?.recordModelCall({
            name: 'audio-transcription-chunk',
            provider: 'OpenRouter STT',
            model: input.model,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            metadata: {
              chunkIndex: input.chunkIndex,
              chunkCount: input.chunkCount,
              networkAttempt: attempt,
              generationId,
              reason:
                error instanceof AudioTranscriptionProviderError
                  ? (error.details?.issues[0]?.code ?? error.code)
                  : 'invalid_model_output',
              ...(error instanceof AudioTranscriptionSplitRequiredError && error.qualityMetrics
                ? { quality: error.qualityMetrics }
                : {}),
            },
          });
          throw error;
        }
        input.report?.recordModelCall({
          name: 'audio-transcription-chunk',
          provider: 'OpenRouter STT',
          model: input.model,
          status: 'completed',
          durationMs: Date.now() - startedAt,
          inputTokens: result.usage?.input_tokens ?? result.usage?.prompt_tokens,
          outputTokens: result.usage?.output_tokens ?? result.usage?.completion_tokens,
          estimatedCostUsd: result.usage?.cost,
          metadata: {
            chunkIndex: input.chunkIndex,
            chunkCount: input.chunkCount,
            networkAttempt: attempt,
            generationId,
            durationMs: input.durationMs,
            billedSeconds: result.usage?.seconds,
            segmentCount: result.segments.length,
            quality: result.qualityMetrics,
            totalTokens: result.usage?.total_tokens,
          },
        });
        return { ...result, ...(generationId ? { generationId } : {}) };
      } catch (error) {
        if (error instanceof AudioTranscriptionProviderError) throw error;
        const timeoutFailure = error instanceof Error && error.name === 'AbortError';
        input.report?.recordModelCall({
          name: 'audio-transcription-chunk',
          provider: 'OpenRouter STT',
          model: input.model,
          status: 'failed',
          durationMs: Date.now() - startedAt,
          metadata: {
            chunkIndex: input.chunkIndex,
            chunkCount: input.chunkCount,
            networkAttempt: attempt,
            reason: timeoutFailure ? 'timeout' : 'network_error',
          },
        });
        if (attempt < MAX_NETWORK_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
          continue;
        }
        const details = diagnosticDetails('timeout', input.chunkIndex, input.chunkCount, [
          {
            path: '$',
            code: timeoutFailure ? 'provider_timeout' : 'provider_network_error',
            message: timeoutFailure ? '转写服务连续超时。' : '无法连接转写服务。',
          },
        ]);
        throw new AudioTranscriptionSplitRequiredError(
          'MODEL_TIMEOUT',
          timeoutFailure ? '当前音频块连续转写超时。' : '当前音频块连续网络失败。',
          details,
          'timeout',
        );
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error('unreachable');
  }
}
