/**
 * HelloWorld 服务状态传输适配器。
 *
 * 请求 API 健康端点、校验共享响应契约，并把网络、超时和无效负载转换为稳定 UI 错误。
 *
 * Responsibilities:
 * - 执行带超时的健康检查。
 * - 隔离传输异常和响应解析细节。
 *
 * Notes:
 * - 不缓存服务状态。
 */
import {
  HelloResponseSchema,
  type HelloResponse,
} from '@echowave/contracts';

import { apiUrl } from '@/shared/api/apiUrl';

/** HelloWorld 健康检查可向 UI 暴露的错误类别。 */
export type ServiceErrorCode = 'INVALID_RESPONSE' | 'NETWORK' | 'TIMEOUT';

/** 将底层 fetch 异常归一化为稳定错误码的客户端错误。 */
export class ServiceRequestError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceRequestError';
  }
}

export async function fetchHello(
  baseUrl = apiUrl,
  timeoutMs = 5_000,
): Promise<HelloResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/hello`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ServiceRequestError(
        'NETWORK',
        `API returned HTTP ${response.status}.`,
      );
    }

    const result = HelloResponseSchema.safeParse(await response.json());
    if (!result.success) {
      throw new ServiceRequestError(
        'INVALID_RESPONSE',
        'API response did not match the shared contract.',
      );
    }

    return result.data;
  } catch (error) {
    if (error instanceof ServiceRequestError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new ServiceRequestError('TIMEOUT', 'API request timed out.');
    }
    throw new ServiceRequestError(
      'NETWORK',
      error instanceof Error ? error.message : 'Unable to reach the API.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
