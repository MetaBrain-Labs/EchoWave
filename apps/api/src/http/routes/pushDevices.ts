/**
 * Expo 推送设备 HTTP 路由。
 *
 * 固定租户首版仅暴露 Token 登记和停用，不把通知事件正文当成任务状态来源。
 *
 * Responsibilities:
 * - 校验共享设备契约。
 * - 返回稳定的创建与无内容删除响应。
 */
import {
  PushDeviceDeleteRequestSchema,
  PushDeviceRegisterRequestSchema,
} from '@echowave/contracts';
import type { Hono } from 'hono';

import type { PushDeviceService } from '../../notifications/service.ts';

/** 注册推送设备端点。 */
export function registerPushDeviceRoutes(app: Hono, service: PushDeviceService): void {
  app.post('/api/push-devices', async (context) =>
    context.json(
      await service.register(PushDeviceRegisterRequestSchema.parse(await context.req.json())),
      201,
    ),
  );
  app.delete('/api/push-devices', async (context) => {
    await service.disable(PushDeviceDeleteRequestSchema.parse(await context.req.json()));
    return context.body(null, 204);
  });
}
