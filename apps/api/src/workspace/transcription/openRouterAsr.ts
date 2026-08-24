/**
 * OpenRouter Gemini 音频转写适配器。
 *
 * 将单个 MP3 分块编码为 `input_audio` 请求，并用严格 JSON Schema 与 Zod 双重约束
 * Speaker、业务角色、情绪、时间戳和原文转写结果。
 *
 * Responsibilities:
 * - 构造不翻译、不补写的英文模型提示。
 * - 对暂时性网络错误有限重试，对非法结构执行一次纠正重试。
 * - 只向调用方返回通过时间边界和 Speaker 引用校验的数据。
 *
 * Notes:
 * - 原始音频和模型正文不会写入普通日志。
 */
import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import type {
  AudioTranscriptionDirectFormat,
  AudioTranscriptionPreprocessing,
} from '@echowave/contracts';

const EmotionSchema = z.enum(['neutral', 'happy', 'angry', 'sad', 'anxious', 'excited', 'unknown']);
const SpeakerSchema = z.object({
  speakerKey: z.string().regex(/^Speaker \d+$/),
  businessRole: z.string().trim().min(1).max(40),
});
const AsrOutputSchema = z.object({
  speakers: z.array(SpeakerSchema),
  segments: z.array(
    z.object({
      speakerKey: z.string().regex(/^Speaker \d+$/),
      emotion: EmotionSchema,
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().positive(),
      text: z.string().trim().min(1),
    }),
  ),
});
const OpenRouterResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

/** 将 Provider HTTP 状态转换为可操作且不泄露响应正文的用户错误。 */
function providerFailureMessage(status: number): string {
  switch (status) {
    case 400:
    case 413:
    case 415:
    case 422:
      return `转写服务拒绝了音频请求（HTTP ${status}），请检查音频或模型参数。`;
    case 401:
      return '转写服务拒绝了 OpenRouter 密钥（HTTP 401），请检查密钥是否有效。';
    case 402:
      return '转写服务额度不足（HTTP 402），请检查 OpenRouter 账户余额。';
    case 403:
      return '转写请求被 OpenRouter 权限或策略拒绝（HTTP 403）。';
    case 404:
      return '当前请求没有可用的 OpenRouter Provider（HTTP 404）。';
    case 429:
      return '转写服务请求过于频繁（HTTP 429），请稍后重试。';
    default:
      return `转写模型当前不可用（HTTP ${status}），请稍后重试。`;
  }
}

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    speakers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          speakerKey: { type: 'string', description: 'Speaker N, numbered from zero.' },
          businessRole: {
            type: 'string',
            description: 'A concise Simplified Chinese business role, or unknown.',
          },
        },
        required: ['speakerKey', 'businessRole'],
      },
    },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          speakerKey: { type: 'string' },
          emotion: {
            type: 'string',
            enum: ['neutral', 'happy', 'angry', 'sad', 'anxious', 'excited', 'unknown'],
          },
          startMs: { type: 'integer', minimum: 0 },
          endMs: { type: 'integer', minimum: 1 },
          text: { type: 'string' },
        },
        required: ['speakerKey', 'emotion', 'startMs', 'endMs', 'text'],
      },
    },
  },
  required: ['speakers', 'segments'],
} as const;

export type AsrSpeaker = z.infer<typeof SpeakerSchema>;
export type AsrChunkResult = z.infer<typeof AsrOutputSchema>;

/** OpenRouter 音频模型调用失败的稳定错误。 */
export class AudioTranscriptionProviderError extends Error {
  constructor(
    public readonly code:
      'DIRECT_AUDIO_REJECTED' | 'INVALID_MODEL_OUTPUT' | 'MODEL_TIMEOUT' | 'MODEL_UNAVAILABLE',
    message: string,
    public readonly retryable = true,
    public readonly providerHttpStatus?: number,
  ) {
    super(message);
    this.name = 'AudioTranscriptionProviderError';
  }
}

/** 通过 OpenRouter 调用固定 Gemini 模型完成单个音频分块转写。 */
export class OpenRouterAsr {
  private readonly fetchImplementation: typeof fetch;

  constructor(
    private readonly options: {
      apiKey: string;
      model: 'google/gemini-2.5-flash-lite';
      fetchImplementation?: typeof fetch;
    },
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  /** 转写一个 MP3 分块，并拒绝越界时间戳或悬空 Speaker 引用。 */
  async transcribeChunk(input: {
    audioPath: string;
    durationMs: number;
    format: AudioTranscriptionDirectFormat;
    knownSpeakers: AsrSpeaker[];
    preprocessingMode: AudioTranscriptionPreprocessing;
  }): Promise<AsrChunkResult> {
    const audio = (await readFile(input.audioPath)).toString('base64');
    for (let structureAttempt = 0; structureAttempt < 2; structureAttempt += 1) {
      const prompt = this.prompt(input.knownSpeakers, structureAttempt > 0);
      const content = await this.request(
        audio,
        prompt,
        input.format,
        input.preprocessingMode === 'direct',
      );
      let candidate: unknown;
      try {
        candidate = JSON.parse(content);
      } catch {
        candidate = undefined;
      }
      const parsed = AsrOutputSchema.safeParse(candidate);
      if (parsed.success && this.isValidResult(parsed.data, input.durationMs)) return parsed.data;
    }
    throw new AudioTranscriptionProviderError(
      'INVALID_MODEL_OUTPUT',
      '转写模型返回了无效结构，请重试。',
    );
  }

  private prompt(knownSpeakers: AsrSpeaker[], correction: boolean): string {
    return [
      'Transcribe the supplied audio exactly in its original language. Never translate, summarize, invent, or normalize away meaning.',
      'Perform speaker diarization. Use Speaker 0, Speaker 1, and so on. Reuse a known key only when the same speaker is reasonably identifiable.',
      'Assign each speaker a concise Simplified Chinese business role such as 销售, 客户, 店员, or 经理. Use unknown when uncertain.',
      'For every spoken segment return millisecond timestamps relative to this audio chunk and one allowed emotion.',
      `Known speakers from earlier chunks: ${JSON.stringify(knownSpeakers)}`,
      correction
        ? 'The previous response was invalid. Return only JSON that exactly matches the schema.'
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private isValidResult(result: AsrChunkResult, durationMs: number): boolean {
    const speakers = new Set(result.speakers.map((speaker) => speaker.speakerKey));
    return (
      new Set(result.speakers.map((speaker) => speaker.speakerKey)).size ===
        result.speakers.length &&
      result.segments.every(
        (segment) =>
          speakers.has(segment.speakerKey) &&
          segment.endMs > segment.startMs &&
          segment.endMs <= durationMs,
      )
    );
  }

  private async request(
    audio: string,
    prompt: string,
    format: AudioTranscriptionDirectFormat,
    direct: boolean,
  ): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1_000);
      try {
        const response = await this.fetchImplementation(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.options.apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://echowave.local',
              'X-Title': 'EchoWave',
            },
            body: JSON.stringify({
              model: this.options.model,
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: prompt },
                    { type: 'input_audio', input_audio: { data: audio, format } },
                  ],
                },
              ],
              provider: { require_parameters: true },
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: 'echowave_audio_transcription',
                  strict: true,
                  schema: responseJsonSchema,
                },
              },
              stream: false,
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          if (direct && [400, 413, 415, 422].includes(response.status)) {
            throw new AudioTranscriptionProviderError(
              'DIRECT_AUDIO_REJECTED',
              '原音频被转写服务拒绝，请启用 FFmpeg 预处理后重试。',
              false,
              response.status,
            );
          }
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
            continue;
          }
          throw new AudioTranscriptionProviderError(
            'MODEL_UNAVAILABLE',
            providerFailureMessage(response.status),
            response.status === 429 || response.status >= 500,
            response.status,
          );
        }
        const parsed = OpenRouterResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new AudioTranscriptionProviderError(
            'INVALID_MODEL_OUTPUT',
            '转写模型返回了无效响应，请重试。',
          );
        }
        return parsed.data.choices[0]!.message.content;
      } catch (error) {
        if (error instanceof AudioTranscriptionProviderError) {
          if (error.retryable && attempt < 2) continue;
          throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          if (attempt < 2) continue;
          throw new AudioTranscriptionProviderError('MODEL_TIMEOUT', '转写模型请求超时。');
        }
        if (attempt >= 2) {
          throw new AudioTranscriptionProviderError('MODEL_UNAVAILABLE', '无法连接转写模型。');
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new AudioTranscriptionProviderError('MODEL_UNAVAILABLE', '转写模型当前不可用。');
  }
}
