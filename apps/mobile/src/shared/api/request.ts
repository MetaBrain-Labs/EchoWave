/**
 * 移动端 API 基础请求设施。
 *
 * 负责请求超时、JSON 编码、共享错误解析与响应契约校验。
 *
 * Responsibilities:
 * - 统一网络和 HTTP 错误语义。
 * - 在客户端信任边界校验响应。
 *
 * Notes:
 * - 本模块不包含任何领域路径或业务状态。
 */
import { ApiErrorResponseSchema } from '@echowave/contracts';

import { apiUrl } from './apiUrl';

/** 工作区读写请求的稳定客户端错误。 */
export class WorkspaceRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'WorkspaceRequestError';
  }
}

type RuntimeSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

type RequestOptions = {
  body?: unknown | FormData;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  timeoutMs?: number;
};

export async function request<T>(
  path: string,
  schema: RuntimeSchema<T>,
  options?: RequestOptions,
): Promise<T>;
export async function request(path: string, schema: null, options: RequestOptions): Promise<void>;
export async function request<T>(
  path: string,
  schema: RuntimeSchema<T> | null,
  options: RequestOptions = {},
): Promise<T | void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const multipart = options.body instanceof FormData;
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      body:
        options.body === undefined
          ? undefined
          : options.body instanceof FormData
            ? options.body
            : JSON.stringify(options.body),
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }),
      },
      method: options.method ?? 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const parsedError = ApiErrorResponseSchema.safeParse(body);
      throw new WorkspaceRequestError(
        parsedError.success
          ? parsedError.data.error.code
          : response.status === 404
            ? 'NOT_FOUND'
            : 'HTTP_ERROR',
        parsedError.success
          ? parsedError.data.error.message
          : response.status === 404
            ? '请求的数据不存在。'
            : `请求失败（HTTP ${response.status}）。`,
        parsedError.success ? parsedError.data.error.retryable : response.status >= 500,
      );
    }
    if (response.status === 204) {
      if (schema === null) return;
      throw new WorkspaceRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。');
    }
    const body: unknown = await response.json();
    if (schema === null) {
      throw new WorkspaceRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new WorkspaceRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。');
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof WorkspaceRequestError) throw error;
    if (controller.signal.aborted) {
      throw new WorkspaceRequestError('TIMEOUT', '请求超时，请重试。', true);
    }
    throw new WorkspaceRequestError('NETWORK', '无法连接服务，请检查网络。', true);
  } finally {
    clearTimeout(timeout);
  }
}
