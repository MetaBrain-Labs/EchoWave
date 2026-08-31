/**
 * API 健康与兼容性路由。
 *
 * 提供不依赖业务服务的 HelloWorld 契约端点。
 *
 * Responsibilities:
 * - 注册 GET /api/hello。
 * - 使用共享契约校验固定响应。
 *
 * Notes:
 * - 响应内容属于项目兼容性不变量。
 */
import { HelloResponseSchema } from '@echowave/contracts';
import type { Hono } from 'hono';

/** 注册基础健康路由。 */
export function registerHealthRoutes(app: Hono): void {
  app.get('/api/hello', (context) =>
    context.json(
      HelloResponseSchema.parse({ ok: true, service: 'echowave-api', message: 'HelloWorld' }),
    ),
  );
}
