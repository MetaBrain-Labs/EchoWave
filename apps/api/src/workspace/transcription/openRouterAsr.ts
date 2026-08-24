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
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import type {
  AudioFailureDetails,
  AudioFailureIssue,
  AudioTranscriptionDirectFormat,
  AudioTranscriptionPreprocessing,
} from '@echowave/contracts';

import type { AiExecutionRecorder } from '../../ai-observability/executionReporter.ts';

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
      startMs: z.number().int(),
      endMs: z.number().int(),
      text: z.string().trim().min(1),
    }),
  ),
});
const OpenRouterResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  provider: z.string().optional(),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
      cost: z.number().nonnegative().optional(),
      prompt_tokens_details: z
        .object({ audio_tokens: z.number().int().nonnegative().optional() })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .optional(),
});

const ProviderErrorSchema = z.object({
  error: z.object({ message: z.string().optional() }).passthrough(),
});

type OpenRouterUsage = z.infer<typeof OpenRouterResponseSchema>['usage'];
type RequestDiagnostics = {
  chunkIndex: number;
  chunkCount: number;
  structureAttempt: number;
  report?: AiExecutionRecorder;
};

/** 将 Zod 问题规范为可持久化、可展示且不包含模型正文的诊断。 */
function zodIssues(issues: z.ZodIssue[]): AudioFailureIssue[] {
  return issues.slice(0, 20).map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '$',
    code: issue.code,
    message:
      issue.code === 'invalid_type'
        ? '字段类型错误或缺少必填字段。'
        : issue.code === 'invalid_value'
          ? '字段值不在允许范围内。'
          : issue.code === 'too_small'
            ? '字段值低于允许范围。'
            : issue.code === 'too_big'
              ? '字段值超出允许范围。'
              : '字段未通过结构校验。',
  }));
}

/** 计算输出指纹，使关闭正文报告时仍能关联两次失败输出。 */
function outputFingerprint(content: string) {
  return {
    outputLength: content.length,
    outputSha256: createHash('sha256').update(content).digest('hex'),
  };
}

/** 将 JSON.parse 错误收敛为稳定类型和位置，不把错误消息中的模型正文写入数据库或 API。 */
function jsonParseIssue(error: unknown): AudioFailureIssue {
  const raw = error instanceof SyntaxError ? error.message : '';
  const position = /position\s+(\d+)/i.exec(raw)?.[1];
  const code = /unexpected end/i.test(raw)
    ? 'json_unexpected_end'
    : /unexpected token/i.test(raw)
      ? 'json_unexpected_token'
      : 'json_syntax_error';
  return {
    path: position ? `$@${position}` : '$',
    code,
    message: position
      ? `模型输出在字符 ${position} 附近不是有效 JSON。`
      : '模型输出不是有效 JSON。',
  };
}

/** 将失败正文限制在单次 20,000 字符以内，并明确标记发生过截断。 */
function limitedFailureOutput(content: string): { content: string; truncated: boolean } {
  const limit = 20_000;
  const suffix = '\n... [truncated]';
  if (content.length <= limit) return { content, truncated: false };
  return { content: `${content.slice(0, limit - suffix.length)}${suffix}`, truncated: true };
}

function semanticIssues(result: AsrChunkResult, durationMs: number): AudioFailureIssue[] {
  const issues: AudioFailureIssue[] = [];
  const speakers = new Set<string>();
  result.speakers.forEach((speaker, index) => {
    if (speakers.has(speaker.speakerKey)) {
      issues.push({
        path: `speakers.${index}.speakerKey`,
        code: 'duplicate_speaker',
        message: `${speaker.speakerKey} 重复定义。`,
      });
    }
    speakers.add(speaker.speakerKey);
  });
  result.segments.forEach((segment, index) => {
    if (segment.startMs < 0) {
      issues.push({
        path: `segments.${index}.startMs`,
        code: 'negative_timestamp',
        message: '片段开始时间不能为负数。',
      });
    }
    if (segment.endMs < 0) {
      issues.push({
        path: `segments.${index}.endMs`,
        code: 'negative_timestamp',
        message: '片段结束时间不能为负数。',
      });
    }
    if (!speakers.has(segment.speakerKey)) {
      issues.push({
        path: `segments.${index}.speakerKey`,
        code: 'unknown_speaker',
        message: `片段引用了未定义的 ${segment.speakerKey}。`,
      });
    }
    if (segment.endMs <= segment.startMs) {
      issues.push({
        path: `segments.${index}.endMs`,
        code: 'invalid_time_range',
        message: '片段结束时间必须晚于开始时间。',
      });
    }
    if (segment.startMs > durationMs || segment.endMs > durationMs) {
      issues.push({
        path:
          segment.startMs > durationMs ? `segments.${index}.startMs` : `segments.${index}.endMs`,
        code: 'timestamp_out_of_bounds',
        message: `片段结束时间超出当前分块时长 ${durationMs}ms。`,
      });
    }
  });
  return issues.slice(0, 20);
}

function providerIssue(status: number, message?: string): AudioFailureIssue {
  const normalized = message?.toLowerCase() ?? '';
  if (normalized.includes('not available in your region')) {
    return { path: '$', code: 'region_unavailable', message: '当前地区无法使用该模型。' };
  }
  if (normalized.includes('guardrail') || normalized.includes('blocked')) {
    return { path: '$', code: 'guardrail_blocked', message: '请求被 Provider 策略阻止。' };
  }
  if (status === 401) {
    return { path: '$', code: 'authentication_failed', message: 'OpenRouter 密钥鉴权失败。' };
  }
  if (status === 402) {
    return { path: '$', code: 'credit_exhausted', message: 'OpenRouter 账户额度不足。' };
  }
  if (status === 403) {
    return { path: '$', code: 'permission_denied', message: '请求被权限或策略拒绝。' };
  }
  if (status === 404) {
    return { path: '$', code: 'provider_unavailable', message: '没有符合请求条件的 Provider。' };
  }
  return { path: '$', code: `http_${status}`, message: `Provider 返回 HTTP ${status}。` };
}

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
    public readonly details: AudioFailureDetails | null = null,
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
    chunkCount?: number;
    chunkIndex?: number;
    durationMs: number;
    format: AudioTranscriptionDirectFormat;
    knownSpeakers: AsrSpeaker[];
    preprocessingMode: AudioTranscriptionPreprocessing;
    report?: AiExecutionRecorder;
  }): Promise<AsrChunkResult> {
    const audio = (await readFile(input.audioPath)).toString('base64');
    const chunkIndex = input.chunkIndex ?? 1;
    const chunkCount = input.chunkCount ?? 1;
    let finalDetails: AudioFailureDetails | null = null;
    for (let structureAttempt = 0; structureAttempt < 2; structureAttempt += 1) {
      const prompt = this.prompt(input.knownSpeakers, structureAttempt > 0);
      const response = await this.request(
        audio,
        prompt,
        input.format,
        input.preprocessingMode === 'direct',
        {
          chunkIndex,
          chunkCount,
          structureAttempt: structureAttempt + 1,
          ...(input.report ? { report: input.report } : {}),
        },
      );
      const content = response.content;
      const fingerprint = outputFingerprint(content);
      let candidate: unknown;
      let parseIssue: AudioFailureIssue | undefined;
      try {
        candidate = JSON.parse(content);
      } catch (error) {
        candidate = undefined;
        parseIssue = jsonParseIssue(error);
      }
      const parsed = AsrOutputSchema.safeParse(candidate);
      let category: AudioFailureDetails['category'];
      let issues: AudioFailureIssue[];
      if (parseIssue) {
        category = 'invalid_json';
        issues = [parseIssue];
      } else if (!parsed.success) {
        category = 'schema_validation';
        issues = zodIssues(parsed.error.issues);
      } else {
        issues = semanticIssues(parsed.data, input.durationMs);
        if (issues.length === 0) return parsed.data;
        category = 'semantic_validation';
      }
      finalDetails = {
        category,
        chunkIndex,
        chunkCount,
        structureAttempts: structureAttempt + 1,
        issues,
        ...fingerprint,
      };
      input.report?.recordStep({
        name: 'validate-model-output',
        status: 'failed',
        metadata: finalDetails,
      });
      const reportOutput = limitedFailureOutput(content);
      input.report?.recordOutput({
        kind: 'failed-model-output',
        chunkIndex,
        structureAttempt: structureAttempt + 1,
        outputLength: fingerprint.outputLength,
        outputSha256: fingerprint.outputSha256,
        content: reportOutput.content,
        truncated: reportOutput.truncated,
      });
    }
    throw new AudioTranscriptionProviderError(
      'INVALID_MODEL_OUTPUT',
      `第 ${chunkIndex}/${chunkCount} 个音频分块在 2 次结构纠正后仍未通过校验：${finalDetails?.issues[0]?.message ?? '模型输出无效'} 请重新转写。`,
      true,
      undefined,
      finalDetails,
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

  private async request(
    audio: string,
    prompt: string,
    format: AudioTranscriptionDirectFormat,
    direct: boolean,
    diagnostics: RequestDiagnostics,
  ): Promise<{ content: string; usage?: OpenRouterUsage }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1_000);
      const startedAt = Date.now();
      let modelCallRecorded = false;
      const metadata = {
        chunkIndex: diagnostics.chunkIndex,
        chunkCount: diagnostics.chunkCount,
        structureAttempt: diagnostics.structureAttempt,
        networkAttempt: attempt + 1,
        format,
        preprocessingMode: direct ? 'direct' : 'ffmpeg',
      };
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
          const providerPayload: unknown = await response.json().catch(() => undefined);
          const providerError = ProviderErrorSchema.safeParse(providerPayload);
          const issue = providerIssue(
            response.status,
            providerError.success ? providerError.data.error.message : undefined,
          );
          const details: AudioFailureDetails = {
            category: 'provider',
            chunkIndex: diagnostics.chunkIndex,
            chunkCount: diagnostics.chunkCount,
            structureAttempts: diagnostics.structureAttempt,
            issues: [issue],
            outputLength: null,
            outputSha256: null,
          };
          diagnostics.report?.recordModelCall({
            name: 'audio-transcription-chunk',
            provider: 'OpenRouter',
            model: this.options.model,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            metadata: { ...metadata, providerHttpStatus: response.status, reason: issue.code },
          });
          modelCallRecorded = true;
          if (direct && [400, 413, 415, 422].includes(response.status)) {
            throw new AudioTranscriptionProviderError(
              'DIRECT_AUDIO_REJECTED',
              '原音频被转写服务拒绝，请启用 FFmpeg 预处理后重试。',
              false,
              response.status,
              details,
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
            details,
          );
        }
        const parsed = OpenRouterResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          const details: AudioFailureDetails = {
            category: 'schema_validation',
            chunkIndex: diagnostics.chunkIndex,
            chunkCount: diagnostics.chunkCount,
            structureAttempts: diagnostics.structureAttempt,
            issues: zodIssues(parsed.error.issues),
            outputLength: null,
            outputSha256: null,
          };
          diagnostics.report?.recordModelCall({
            name: 'audio-transcription-chunk',
            provider: 'OpenRouter',
            model: this.options.model,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            metadata: { ...metadata, reason: 'invalid_response_envelope' },
          });
          modelCallRecorded = true;
          throw new AudioTranscriptionProviderError(
            'INVALID_MODEL_OUTPUT',
            '转写模型返回了无效响应，请重试。',
            true,
            undefined,
            details,
          );
        }
        const usage = parsed.data.usage;
        diagnostics.report?.recordModelCall({
          name: 'audio-transcription-chunk',
          provider: parsed.data.provider ?? 'OpenRouter',
          model: this.options.model,
          status: 'completed',
          durationMs: Date.now() - startedAt,
          inputTokens: usage?.prompt_tokens,
          outputTokens: usage?.completion_tokens,
          estimatedCostUsd: usage?.cost,
          metadata: {
            ...metadata,
            totalTokens: usage?.total_tokens,
            audioTokens: usage?.prompt_tokens_details?.audio_tokens,
          },
        });
        modelCallRecorded = true;
        return {
          content: parsed.data.choices[0]!.message.content,
          ...(usage ? { usage } : {}),
        };
      } catch (error) {
        if (error instanceof AudioTranscriptionProviderError) {
          if (error.retryable && attempt < 2) continue;
          throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          if (!modelCallRecorded) {
            diagnostics.report?.recordModelCall({
              name: 'audio-transcription-chunk',
              provider: 'OpenRouter',
              model: this.options.model,
              status: 'failed',
              durationMs: Date.now() - startedAt,
              metadata: { ...metadata, reason: 'timeout' },
            });
          }
          if (attempt < 2) continue;
          throw new AudioTranscriptionProviderError(
            'MODEL_TIMEOUT',
            '转写模型请求超时。',
            true,
            undefined,
            {
              category: 'timeout',
              chunkIndex: diagnostics.chunkIndex,
              chunkCount: diagnostics.chunkCount,
              structureAttempts: diagnostics.structureAttempt,
              issues: [{ path: '$', code: 'timeout', message: '模型请求超时。' }],
              outputLength: null,
              outputSha256: null,
            },
          );
        }
        if (!modelCallRecorded) {
          diagnostics.report?.recordModelCall({
            name: 'audio-transcription-chunk',
            provider: 'OpenRouter',
            model: this.options.model,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            metadata: { ...metadata, reason: 'network_error' },
          });
        }
        if (attempt >= 2) {
          throw new AudioTranscriptionProviderError(
            'MODEL_UNAVAILABLE',
            '无法连接转写模型。',
            true,
            undefined,
            {
              category: 'provider',
              chunkIndex: diagnostics.chunkIndex,
              chunkCount: diagnostics.chunkCount,
              structureAttempts: diagnostics.structureAttempt,
              issues: [{ path: '$', code: 'network_error', message: '无法连接转写服务。' }],
              outputLength: null,
              outputSha256: null,
            },
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new AudioTranscriptionProviderError('MODEL_UNAVAILABLE', '转写模型当前不可用。');
  }
}
