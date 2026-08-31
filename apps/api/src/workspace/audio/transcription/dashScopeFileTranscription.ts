/**
 * DashScope Qwen Audio 整文件转写适配器。
 *
 * 提交北京地域异步文件转写任务、单次查询任务状态，并把最终 Speaker 输出归一为正文段落。
 *
 * Responsibilities:
 * - 为 Polling 模式执行一次状态查询，调用方负责持久化下一次调度时间。
 * - 下载终态发现机制提供的短期结果地址。
 * - 严格校验 Speaker、时间戳和顺序，不对无效结果静默降级。
 * - 按说话人变化、停顿和软字符上限生成独立正文段落。
 *
 * Notes:
 * - 业务角色与情绪分析不属于本适配器，始终返回 unknown。
 */
import { z } from 'zod';

import type { TranscriptDraft } from './repository.ts';
import {
  noOpSttRawResponseReporter,
  type SttRawResponseKind,
  type SttRawResponseOutcome,
  type SttRawResponseReporter,
} from '../../../ai-observability/sttRawResponseReporter.ts';
import { AudioTranscriptionProviderError } from './errors.ts';

const RESULT_RETRY_DELAYS_MS = [1_000, 2_000] as const;
const SPEAKER_BREAK_MS = 1_500;
const SEGMENT_SOFT_LIMIT = 240;

const SubmitResponseSchema = z.object({
  output: z.object({ task_id: z.string().min(1) }),
});
const TaskStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'UNKNOWN',
]);
const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:');
const TaskResponseSchema = z.object({
  output: z
    .object({
      task_id: z.string().min(1).optional(),
      task_status: TaskStatusSchema,
      results: z
        .array(
          z
            .object({
              transcription_url: HttpsUrlSchema.optional(),
            })
            .passthrough(),
        )
        .optional(),
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .passthrough(),
});

const SentenceSchema = z
  .object({
    begin_time: z.number().int().nonnegative(),
    end_time: z.number().int().positive(),
    text: z.string(),
    speaker_id: z.union([z.string(), z.number()]),
  })
  .passthrough();
const TranscriptionResultSchema = z.object({
  transcripts: z.array(z.object({ sentences: z.array(SentenceSchema) }).passthrough()).min(1),
});

type FetchLike = typeof fetch;
type Sleep = (durationMs: number) => Promise<void>;
export type DashScopeRawResponseContext = {
  revisionId: string;
  durationMs: number;
  preprocessing?: 'silero_vad' | 'whole_file';
};

/** DashScope 完成态返回的安全归一化结果。 */
export type DashScopeTranscriptionResult = {
  segments: TranscriptDraft[];
  taskId: string;
};

/** 单次供应商查询返回的安全任务状态。 */
export type DashScopeTaskStatusResult = {
  taskId: string;
  status: z.infer<typeof TaskStatusSchema>;
  resultUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

function invalidOutput(message: string): AudioTranscriptionProviderError {
  return new AudioTranscriptionProviderError('INVALID_MODEL_OUTPUT', message, true, undefined, {
    category: 'semantic_validation',
    chunkIndex: null,
    chunkCount: null,
    structureAttempts: 0,
    issues: [{ path: 'output', code: 'invalid_dashscope_output', message }],
    outputLength: null,
    outputSha256: null,
  });
}

function joinText(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  const needsSpace = /[A-Za-z0-9]$/u.test(left) && /^[A-Za-z0-9]/u.test(right);
  return `${left}${needsSpace ? ' ' : ''}${right}`;
}

/** 将 Qwen 句级 Speaker 输出转换为录音级说话轮次段落。 */
export function normalizeSpeakerTurnSegments(
  input: unknown,
  durationMs?: number,
): TranscriptDraft[] {
  const parsed = TranscriptionResultSchema.safeParse(input);
  if (!parsed.success) throw invalidOutput('供应商结果缺少有效的 Speaker 句子或时间戳。');

  const sentences = parsed.data.transcripts.flatMap((transcript) => transcript.sentences);
  if (sentences.length === 0) throw invalidOutput('供应商返回了空转写结果。');

  const speakerKeys = new Map<string, string>();
  const segments: TranscriptDraft[] = [];
  let previousSentenceEnd = -1;
  for (const sentence of sentences) {
    const text = sentence.text.trim();
    const rawSpeaker = String(sentence.speaker_id).trim();
    if (!text) continue;
    if (
      !rawSpeaker ||
      sentence.end_time <= sentence.begin_time ||
      (durationMs !== undefined && sentence.end_time > durationMs)
    ) {
      throw invalidOutput('供应商结果包含缺失 Speaker 或无效时间范围的句子。');
    }
    if (sentence.begin_time < previousSentenceEnd) {
      throw invalidOutput('供应商句子时间戳乱序或相互重叠。');
    }
    previousSentenceEnd = sentence.end_time;

    let speakerKey = speakerKeys.get(rawSpeaker);
    if (!speakerKey) {
      speakerKey = `Speaker ${speakerKeys.size}`;
      speakerKeys.set(rawSpeaker, speakerKey);
    }
    const previous = segments.at(-1);
    const mergedText = previous ? joinText(previous.text, text) : text;
    const shouldMerge =
      previous !== undefined &&
      previous.speakerKey === speakerKey &&
      sentence.begin_time - previous.endMs < SPEAKER_BREAK_MS &&
      mergedText.length <= SEGMENT_SOFT_LIMIT;

    if (shouldMerge) {
      previous.endMs = sentence.end_time;
      previous.text = mergedText;
    } else {
      segments.push({
        speakerKey,
        businessRole: 'unknown',
        emotion: 'unknown',
        startMs: sentence.begin_time,
        endMs: sentence.end_time,
        text,
      });
    }
  }

  if (segments.length === 0) throw invalidOutput('供应商返回了空音频或空白转写。');
  return segments;
}

/** 提交、单次查询并下载 Qwen Audio 3.0 文件转写任务结果。 */
export class DashScopeFileTranscription {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: Sleep = (durationMs) =>
      new Promise((resolve) => setTimeout(resolve, durationMs)),
    private readonly rawResponseReporter: SttRawResponseReporter = noOpSttRawResponseReporter,
  ) {}

  /** 创建仅包含一个整文件 URL 的异步说话人分离任务。 */
  async submit(fileUrl: string, context?: DashScopeRawResponseContext): Promise<string> {
    const response = await this.request(`${this.baseUrl}/services/audio/asr/transcription`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: 'qwen-audio-3.0-asr-flash-filetrans',
        input: { file_urls: [fileUrl] },
        parameters: {
          channel_id: [0],
          language_hints: ['zh', 'en'],
          diarization_enabled: true,
          special_word_filter: { system_reserved_filter: false },
        },
      }),
    });
    return (
      await this.parseResponse(
        response,
        SubmitResponseSchema,
        context,
        'task_submission',
        1,
        'DashScope 未返回有效的异步任务 ID。',
      )
    ).data.output.task_id;
  }

  /** 为 Polling 模式执行一次任务状态查询，不在适配器内部等待或循环。 */
  async queryTask(
    taskId: string,
    networkAttempt: number,
    context?: DashScopeRawResponseContext,
  ): Promise<DashScopeTaskStatusResult> {
    const response = await this.request(`${this.baseUrl}/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const parsed = await this.parseResponse(
      response,
      TaskResponseSchema,
      context,
      'task_status',
      networkAttempt,
      'DashScope 任务状态结构无效。',
    );
    const output = parsed.data.output;
    if (output.task_id && output.task_id !== taskId) {
      throw invalidOutput('DashScope 任务状态中的 task ID 不匹配。');
    }
    return {
      taskId,
      status: output.task_status,
      resultUrl:
        output.task_status === 'SUCCEEDED'
          ? (output.results?.find((result) => result.transcription_url)?.transcription_url ?? null)
          : null,
      errorCode:
        output.task_status === 'FAILED' ||
        output.task_status === 'CANCELED' ||
        output.task_status === 'UNKNOWN'
          ? (output.code ?? output.task_status).slice(0, 100)
          : null,
      errorMessage:
        output.task_status === 'FAILED' ||
        output.task_status === 'CANCELED' ||
        output.task_status === 'UNKNOWN'
          ? (output.message ?? 'DashScope 文件转写未成功完成。').slice(0, 500)
          : null,
    };
  }

  /** 下载终态携带的结果地址；仅网络或临时 HTTP 错误最多重试三次。 */
  async fetchResult(
    taskId: string,
    resultUrl: string,
    context?: DashScopeRawResponseContext,
  ): Promise<DashScopeTranscriptionResult> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await this.request(resultUrl);
        const parsedResult = await this.parseResponse(
          response,
          TranscriptionResultSchema,
          context,
          'transcription_result',
          attempt,
          'DashScope 最终转写结果结构无效。',
          false,
        );
        try {
          const segments = normalizeSpeakerTurnSegments(parsedResult.data, context?.durationMs);
          await this.recordRaw(
            context,
            response,
            parsedResult.rawResponseText,
            'transcription_result',
            attempt,
            'completed',
          );
          return { segments, taskId };
        } catch (error) {
          await this.recordRaw(
            context,
            response,
            parsedResult.rawResponseText,
            'transcription_result',
            attempt,
            'validation_error',
          );
          throw error;
        }
      } catch (error) {
        const retryable =
          error instanceof AudioTranscriptionProviderError &&
          error.retryable &&
          error.code !== 'INVALID_MODEL_OUTPUT';
        if (!retryable || attempt === 3) throw error;
        await this.sleep(RESULT_RETRY_DELAYS_MS[attempt - 1]!);
      }
    }
    throw new AudioTranscriptionProviderError(
      'MODEL_UNAVAILABLE',
      'DashScope 转写结果下载失败。',
      true,
    );
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new AudioTranscriptionProviderError(
        'MODEL_UNAVAILABLE',
        'DashScope 网络请求失败。',
        true,
      );
    }
    return response;
  }

  private async parseResponse<T>(
    response: Response,
    schema: z.ZodType<T>,
    context: DashScopeRawResponseContext | undefined,
    responseKind: SttRawResponseKind,
    networkAttempt: number,
    invalidMessage: string,
    recordCompleted = true,
  ): Promise<{ data: T; rawResponseText: string }> {
    const rawResponseText = await response.text();
    if (!response.ok) {
      await this.recordRaw(
        context,
        response,
        rawResponseText,
        responseKind,
        networkAttempt,
        'http_error',
      );
      throw new AudioTranscriptionProviderError(
        response.status === 408 || response.status === 504 ? 'MODEL_TIMEOUT' : 'MODEL_UNAVAILABLE',
        `DashScope 请求失败（HTTP ${response.status}）。`,
        response.status === 408 || response.status === 429 || response.status >= 500,
        response.status,
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawResponseText);
    } catch {
      await this.recordRaw(
        context,
        response,
        rawResponseText,
        responseKind,
        networkAttempt,
        'invalid_json',
      );
      throw invalidOutput(invalidMessage);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      await this.recordRaw(
        context,
        response,
        rawResponseText,
        responseKind,
        networkAttempt,
        'validation_error',
      );
      throw invalidOutput(invalidMessage);
    }
    if (recordCompleted) {
      await this.recordRaw(
        context,
        response,
        rawResponseText,
        responseKind,
        networkAttempt,
        'completed',
      );
    }
    return { data: parsed.data, rawResponseText };
  }

  private async recordRaw(
    context: DashScopeRawResponseContext | undefined,
    response: Response,
    rawResponseText: string,
    responseKind: SttRawResponseKind,
    networkAttempt: number,
    outcome: SttRawResponseOutcome,
  ): Promise<void> {
    if (!context) return;
    await this.rawResponseReporter.record({
      revisionId: context.revisionId,
      model: 'qwen-audio-3.0-asr-flash-filetrans',
      provider: 'dashscope',
      responseKind,
      preprocessing: context.preprocessing ?? 'whole_file',
      format: 'mp3',
      chunkIndex: 1,
      chunkCount: 1,
      durationMs: context.durationMs,
      networkAttempt,
      httpStatus: response.status,
      ...(response.headers.get('content-type')
        ? { contentType: response.headers.get('content-type')! }
        : {}),
      outcome,
      rawResponseText,
    });
  }
}
