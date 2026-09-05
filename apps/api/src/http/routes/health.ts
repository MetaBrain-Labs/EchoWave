/**
 * API 健康与兼容性路由。
 *
 * 提供不依赖业务服务的 EchoWave 身份探测与 HelloWorld 兼容端点。
 *
 * Responsibilities:
 * - 注册 GET /health 与 GET /api/hello。
 * - 使用共享契约校验固定响应。
 *
 * Notes:
 * - 响应内容属于项目兼容性不变量。
 */
import { readFileSync } from 'node:fs';

import { HealthResponseSchema, HelloResponseSchema } from '@echowave/contracts';
import type { Hono } from 'hono';

const apiPackage = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { version?: unknown };
const API_PACKAGE_VERSION = HealthResponseSchema.shape.version.parse(apiPackage.version);

/** 注册基础健康路由。 */
export function registerHealthRoutes(app: Hono, remotePush: boolean): void {
  app.get('/health', (context) =>
    context.json(
      HealthResponseSchema.parse({
        name: 'EchoWave',
        service: 'echowave-api',
        version: API_PACKAGE_VERSION,
        apiVersion: 1,
        status: 'ok',
        capabilities: { remotePush },
      }),
    ),
  );
  app.get('/api/hello', (context) =>
    context.json(
      HelloResponseSchema.parse({ ok: true, service: 'echowave-api', message: 'HelloWorld' }),
    ),
  );
}
