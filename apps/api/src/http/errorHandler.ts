/**
 * Hono 全局错误映射。
 *
 * 将校验错误和领域错误转换为稳定、不泄露内部实现的 HTTP 响应。
 *
 * Responsibilities:
 * - 安装结构化 404 与错误处理器。
 * - 保持既有状态码、错误码和用户文案。
 *
 * Notes:
 * - 未知错误只记录 Error 对象，不返回供应商堆栈或敏感数据。
 */
import type { ApiErrorCode } from '@echowave/contracts';
import type { Hono } from 'hono';
import { ZodError } from 'zod';

import { KnowledgeAnswerError } from '../knowledge/answer/knowledgeAnswer.ts';
import { RagRepositoryError } from '../knowledge/persistence/errors.ts';
import { UploadValidationError } from '../knowledge/service.ts';
import { WorkspaceRepositoryError } from '../workspace/errors.ts';
import { SettingsError } from '../settings/types.ts';
import { AudioUploadValidationError } from '../workspace/data-sources/service.ts';
import { errorBody } from './response.ts';

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 500 | 503 | 504;

/** 安装应用级 404 和异常映射。 */
export function installErrorHandlers(app: Hono): void {
  app.notFound((context) => context.json(errorBody('NOT_FOUND', 'Route not found.'), 404));

  app.onError((error, context) => {
    let status: ErrorStatus = 500;
    let code: ApiErrorCode = 'INTERNAL_ERROR';
    let message = '服务暂时无法完成请求。';
    let retryable = false;
    if (
      error instanceof ZodError ||
      (error instanceof SyntaxError && error.message.includes('JSON'))
    ) {
      status = 400;
      code = 'BAD_REQUEST';
      message = '请求参数无效。';
    } else if (error instanceof RagRepositoryError) {
      status = error.code === 'NOT_FOUND' ? 404 : 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof WorkspaceRepositoryError) {
      status =
        error.code === 'NOT_FOUND' ? 404 : error.code === 'TRANSCODER_UNAVAILABLE' ? 503 : 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof AudioUploadValidationError) {
      status = error.code === 'AUDIO_TOO_LARGE' ? 413 : 400;
      code = error.code;
      message = error.message;
    } else if (error instanceof UploadValidationError) {
      status = error.code === 'DOCUMENT_TOO_LARGE' ? 413 : 400;
      code = error.code;
      message = error.message;
    } else if (error instanceof KnowledgeAnswerError) {
      status = error.code === 'MODEL_TIMEOUT' ? 504 : 503;
      code = error.code;
      message = error.message;
      retryable = true;
    } else if (error instanceof SettingsError) {
      status =
        error.code === 'UNAUTHORIZED'
          ? 401
          : error.code === 'INSECURE_CREDENTIAL_TRANSPORT'
            ? 403
            : error.code === 'NOT_FOUND'
              ? 404
              : error.code === 'CONFLICT'
                ? 409
                : 400;
      code = error.code;
      message = error.message;
    } else {
      console.error('Unhandled API error', error);
    }
    return context.json(errorBody(code, message, retryable), status);
  });
}
