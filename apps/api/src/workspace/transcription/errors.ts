/**
 * 音频转写供应商错误。
 *
 * 定义与具体供应商适配器解耦的稳定失败类型，供 worker 持久化安全错误码、重试性和
 * 结构化诊断，不携带音频或供应商原始正文。
 *
 * Responsibilities:
 * - 统一转写供应商的错误码与 HTTP 状态。
 * - 为客户端安全诊断保留经过约束的失败详情。
 *
 * Notes:
 * - 供应商原始响应只能进入受控的本地执行报告。
 */
import type { AudioFailureDetails } from '@echowave/contracts';

/** 官方转写服务调用失败的稳定错误。 */
export class AudioTranscriptionProviderError extends Error {
  constructor(
    public readonly code: 'INVALID_MODEL_OUTPUT' | 'MODEL_TIMEOUT' | 'MODEL_UNAVAILABLE',
    message: string,
    public readonly retryable = true,
    public readonly providerHttpStatus?: number,
    public readonly details: AudioFailureDetails | null = null,
  ) {
    super(message);
    this.name = 'AudioTranscriptionProviderError';
  }
}
