/**
 * Hono HTTP 访问日志与请求追踪中间件。
 *
 * 为每个请求生成 requestId、写入 X-Request-Id 响应头，把请求上下文放进
 * AsyncLocalStorage，并在响应完成后输出一行访问日志。
 *
 * Responsibilities:
 * - 建立 requestId 与应用级日志上下文。
 * - 按状态码选择访问日志级别。
 *
 * Notes:
 * - 不读取或记录请求 body 与 headers，只记录方法、路径、状态码与耗时。
 * - 异常的 Error 堆栈由 errorHandler 统一记录，此处只记录请求事实，避免重复堆栈。
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { MiddlewareHandler } from 'hono';

import { getLogger, runWithLogContext, type LogContext } from '../infrastructure/logger.ts';

type RequestLogContext = Omit<LogContext, 'requestId' | 'component'>;

/** 创建请求追踪与访问日志中间件，应尽早安装以覆盖 CORS 预检与错误响应。 */
export function requestLogging(logContext: RequestLogContext = {}): MiddlewareHandler {
  return async (context, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();

    context.header('X-Request-Id', requestId);

    return runWithLogContext({ ...logContext, requestId, component: 'http' }, async () => {
      let failed = false;

      try {
        await next();
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        const durationMs = Math.round(performance.now() - startedAt);
        const path = context.req.path;
        const statusCode = failed ? 500 : context.res.status;
        const fields = { method: context.req.method, path, statusCode, durationMs };
        const logger = getLogger();

        // 健康检查属于高频噪声，只在 debug 级别保留。
        if (path === '/health') {
          logger.debug(fields, 'HTTP request completed');
        } else if (failed || statusCode >= 500) {
          logger.error(fields, 'HTTP request completed');
        } else if (statusCode >= 400) {
          logger.warn(fields, 'HTTP request completed');
        } else {
          logger.info(fields, 'HTTP request completed');
        }
      }
    });
  };
}
