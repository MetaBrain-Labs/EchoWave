/**
 * DashScope 异步转写完成回调服务。
 *
 * 在 HTTP 边界完成 EventBridge 验签与 CloudEvents 结构校验，只把终态和短期结果地址写入
 * PostgreSQL；耗时的结果下载、校验与发布由转写 worker 完成。
 *
 * Responsibilities:
 * - 校验固定北京地域、固定模型和任务终态。
 * - 将重复投递收敛为 revision 上的幂等供应商回调状态。
 *
 * Notes:
 * - 合法但不属于当前租户的任务会被确认并忽略，避免无意义重投。
 */
import { z } from 'zod';

import type { SttRawResponseReporter } from '../../../ai-observability/sttRawResponseReporter.ts';
import type { AudioAnalysisRepository } from './repository.ts';
import {
  EventBridgeSignatureError,
  type EventBridgeSignatureVerifier,
} from './eventBridgeSignature.ts';
import { handleDashScopeTaskResult } from './dashScopeTaskResult.ts';

const MODEL = 'qwen-audio-3.0-asr-flash-filetrans';
const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'CANCELED', 'UNKNOWN'] as const;
const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:');

const CallbackSchema = z
  .object({
    specversion: z.literal('1.0'),
    id: z.string().min(1).max(256),
    source: z.literal('acs.dashscope'),
    type: z.literal('dashscope:System:AsyncTaskFinish'),
    aliyunregionid: z.literal('cn-beijing'),
    data: z.object({
      task_id: z.string().min(1).max(256),
      task_status: z.enum(TERMINAL_STATUSES),
      region: z.literal('cn-beijing'),
      contain_result: z.literal(true),
      user_api_unique_key: z.string().min(1),
      output_result: z.object({
        output: z
          .object({
            task_id: z.string().min(1),
            task_status: z.enum(TERMINAL_STATUSES),
            results: z
              .array(
                z
                  .object({
                    subtask_status: z.string().optional(),
                    transcription_url: HttpsUrlSchema.optional(),
                  })
                  .passthrough(),
              )
              .optional(),
            code: z.string().optional(),
            message: z.string().optional(),
          })
          .passthrough(),
      }),
    }),
  })
  .passthrough();

/** HTTP 层用于映射回调失败状态的稳定错误。 */
export class DashScopeCallbackError extends Error {
  constructor(
    public readonly kind: 'bad_request' | 'unauthorized' | 'temporary_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'DashScopeCallbackError';
  }
}

/** 验签、解析并持久化 DashScope 任务完成事件。 */
export class DashScopeCallbackService {
  constructor(
    private readonly options: {
      repository: AudioAnalysisRepository;
      signatureVerifier?: EventBridgeSignatureVerifier;
      resolveSignatureVerifier?: (taskId: string) => Promise<EventBridgeSignatureVerifier>;
      rawResponseReporter: SttRawResponseReporter;
    },
  ) {}

  /** 接受一个原始 EventBridge HTTP 请求并返回是否关联到当前 revision。 */
  async receive(rawBody: string, headers: Headers): Promise<'accepted' | 'ignored'> {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new DashScopeCallbackError('bad_request', 'EventBridge callback body is not JSON.');
    }
    const parsed = CallbackSchema.safeParse(payload);
    if (!parsed.success) {
      throw new DashScopeCallbackError('bad_request', 'EventBridge callback structure is invalid.');
    }
    const { data, id: eventId } = parsed.data;
    let signatureVerifier = this.options.signatureVerifier;
    if (!signatureVerifier && this.options.resolveSignatureVerifier) {
      signatureVerifier = await this.options.resolveSignatureVerifier(data.task_id);
    }
    if (!signatureVerifier) {
      throw new DashScopeCallbackError('temporary_unavailable', 'Callback verifier unavailable.');
    }
    try {
      await signatureVerifier.verify(rawBody, headers);
    } catch (error) {
      if (error instanceof EventBridgeSignatureError) {
        throw new DashScopeCallbackError(error.kind, error.message);
      }
      throw error;
    }
    if (!data.user_api_unique_key.endsWith(`:${MODEL}`)) {
      throw new DashScopeCallbackError('bad_request', 'EventBridge callback model mismatch.');
    }
    if (data.output_result.output.task_id !== data.task_id) {
      throw new DashScopeCallbackError('bad_request', 'EventBridge callback task ID mismatch.');
    }
    if (data.output_result.output.task_status !== data.task_status) {
      throw new DashScopeCallbackError('bad_request', 'EventBridge callback status mismatch.');
    }

    const successfulResult = data.output_result.output.results?.find(
      (result) => result.subtask_status === 'SUCCEEDED' && result.transcription_url,
    );
    const terminal = {
      source: 'eventbridge' as const,
      eventId,
      taskId: data.task_id,
      status: data.task_status,
      receivedAt: new Date(),
      resultUrl:
        data.task_status === 'SUCCEEDED' ? (successfulResult?.transcription_url ?? null) : null,
      errorCode:
        data.task_status === 'SUCCEEDED'
          ? null
          : (data.output_result.output.code ?? data.task_status).slice(0, 100),
      errorMessage:
        data.task_status === 'SUCCEEDED'
          ? null
          : (data.output_result.output.message ?? 'DashScope 文件转写未成功完成。').slice(0, 500),
    };
    const recorded = await handleDashScopeTaskResult(this.options.repository, terminal);
    if (!recorded) return 'ignored';

    await this.options.rawResponseReporter.record({
      revisionId: recorded.revisionId,
      model: MODEL,
      provider: 'dashscope',
      responseKind: 'task_callback',
      preprocessing: recorded.preprocessing,
      format: 'mp3',
      chunkIndex: 1,
      chunkCount: 1,
      durationMs: recorded.durationMs,
      networkAttempt: 1,
      httpStatus: 200,
      contentType: headers.get('content-type') ?? undefined,
      outcome: 'completed',
      rawResponseText: rawBody,
    });
    return 'accepted';
  }
}
