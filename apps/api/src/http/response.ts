/**
 * HTTP 请求与响应基础能力。
 *
 * 提供跨领域路由共同使用的实体标识校验和稳定错误体构造。
 *
 * Responsibilities:
 * - 在传输边界校验 UUID。
 * - 通过共享契约构造错误响应。
 *
 * Notes:
 * - 不处理领域错误到状态码的映射。
 */
import { ApiErrorResponseSchema, EntityIdSchema, type ApiErrorCode } from '@echowave/contracts';

/** 构造通过共享契约校验的 API 错误体。 */
export function errorBody(code: ApiErrorCode, message: string, retryable = false) {
  return ApiErrorResponseSchema.parse({ ok: false, error: { code, message, retryable } });
}

/** 校验路由参数中的实体 UUID。 */
export function entityId(value: string): string {
  return EntityIdSchema.parse(value);
}
