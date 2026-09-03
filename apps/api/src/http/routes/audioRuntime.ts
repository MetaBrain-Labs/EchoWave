/**
 * 音频运行模式 HTTP 路由。
 *
 * 暴露公开的非敏感模式概览，并以管理员口令保护租户级修改。
 *
 * Responsibilities:
 * - 在信任边界解析共享契约。
 * - 不向客户端返回对象键或 Credential。
 */
import { AudioRuntimeUpdateRequestSchema } from '@echowave/contracts';
import type { Hono } from 'hono';

import type { AudioRuntimeService } from '../../workspace/audio/runtime-mode/service.ts';

/** 注册音频运行模式读取与管理端点。 */
export function registerAudioRuntimeRoutes(app: Hono, service: AudioRuntimeService): void {
  app.get('/api/audio-runtime', async (context) => context.json(await service.overview()));
  app.put('/api/settings/audio-runtime', async (context) =>
    context.json(
      await service.update(
        context.req.header('authorization'),
        AudioRuntimeUpdateRequestSchema.parse(await context.req.json()),
      ),
    ),
  );
}
