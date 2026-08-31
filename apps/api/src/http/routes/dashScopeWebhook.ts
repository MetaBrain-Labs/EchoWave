/**
 * DashScope Webhook 路由。
 *
 * 在 HTTP 边界接收异步任务完成通知，并将签名校验与持久化委托给 callback service。
 *
 * Responsibilities:
 * - 注册异步任务完成回调端点。
 * - 稳定映射无效、未授权与临时失败响应。
 *
 * Notes:
 * - 未配置 callback service 时不注册该路由。
 */
import type { Hono } from 'hono';

import {
  DashScopeCallbackError,
  type DashScopeCallbackService,
} from '../../workspace/audio/transcription/dashScopeCallback.ts';
import { errorBody } from '../response.ts';

/** 注册 DashScope EventBridge 回调路由。 */
export function registerDashScopeWebhookRoutes(app: Hono, service: DashScopeCallbackService): void {
  app.post('/api/webhooks/dashscope/async-task-finished', async (context) => {
    const rawBody = await context.req.text();
    try {
      await service.receive(rawBody, context.req.raw.headers);
      return context.body(null, 204);
    } catch (error) {
      if (error instanceof DashScopeCallbackError) {
        const status =
          error.kind === 'bad_request' ? 400 : error.kind === 'unauthorized' ? 401 : 503;
        return context.json(
          errorBody(
            status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
            status === 400 ? 'Invalid DashScope callback.' : 'DashScope callback rejected.',
            status === 503,
          ),
          status,
        );
      }
      console.error('Failed to persist DashScope callback', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      return context.json(
        errorBody('INTERNAL_ERROR', 'DashScope callback is temporarily unavailable.', true),
        503,
      );
    }
  });
}
