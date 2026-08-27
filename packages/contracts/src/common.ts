/**
 * 共享网络基础契约。
 *
 * 定义跨业务域复用的实体标识和稳定 HTTP 错误结构。
 *
 * Responsibilities:
 * - 统一 UUID 实体标识校验。
 * - 约束不泄露内部实现的错误响应。
 *
 * Notes:
 * - 业务负载 schema 位于各自领域文件。
 */
import { z } from 'zod';

/** 所有网络实体共享的 UUID 标识符 schema。 */
export const EntityIdSchema = z.string().uuid();

/** EchoWave HTTP API 允许使用的稳定错误码 schema。 */
export const ApiErrorCodeSchema = z.enum([
  'AUDIO_TOO_LARGE',
  'BAD_REQUEST',
  'CONFLICT',
  'DOCUMENT_TOO_LARGE',
  'DUPLICATE_DOCUMENT',
  'INTERNAL_ERROR',
  'INVALID_FILE',
  'INVALID_MODEL_OUTPUT',
  'MODEL_TIMEOUT',
  'MODEL_UNAVAILABLE',
  'NOT_FOUND',
  'PROVIDER_REMOVED',
  'TOO_MANY_FILES',
  'TRANSCODER_UNAVAILABLE',
  'UNSUPPORTED_FORMAT',
]);

/** 不泄露内部实现的统一 HTTP 错误响应 schema。 */
export const ApiErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
  }),
});

/** 稳定 HTTP 错误码类型。 */
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
/** 统一 HTTP 错误响应类型。 */
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
