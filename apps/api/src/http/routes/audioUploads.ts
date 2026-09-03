/**
 * 音频上传会话 HTTP 路由。
 *
 * 暴露会话初始化、API 二进制流写入与完成确认三个信任边界。
 *
 * Responsibilities:
 * - 在进入应用服务前校验共享契约和 Content-Length。
 * - 避免 Hono 为大音频构造 ArrayBuffer 或 multipart 副本。
 */
import { AudioUploadSessionCreateRequestSchema } from '@echowave/contracts';
import type { Hono } from 'hono';

import type { AudioUploadSessionService } from '../../workspace/audio/runtime-mode/uploadSessionService.ts';
import { WorkspaceRepositoryError } from '../../workspace/errors.ts';
import { entityId } from '../response.ts';

/** 注册与数据源和上传会话关联的端点。 */
export function registerAudioUploadRoutes(app: Hono, service: AudioUploadSessionService): void {
  app.post('/api/data-sources/:dataSourceId/audio-upload-sessions', async (context) =>
    context.json(
      await service.create(
        entityId(context.req.param('dataSourceId')),
        AudioUploadSessionCreateRequestSchema.parse(await context.req.json()),
      ),
      201,
    ),
  );
  app.put('/api/audio-upload-sessions/:sessionId/content', async (context) => {
    const length = Number(context.req.header('content-length') ?? 0);
    await service.uploadBinary(
      entityId(context.req.param('sessionId')),
      context.req.raw.body,
      length,
    );
    return context.body(null, 204);
  });
  app.post('/api/audio-upload-sessions/:sessionId/complete', async (context) =>
    context.json(await service.complete(entityId(context.req.param('sessionId')))),
  );
  app.put('/api/audio-files/:audioFileId/source-remount', async (context) => {
    const filename = context.req.header('x-audio-filename');
    if (!filename) {
      throw new WorkspaceRepositoryError('BAD_REQUEST', '缺少 X-Audio-Filename 请求头。');
    }
    return context.json(
      await service.remountSource(
        entityId(context.req.param('audioFileId')),
        filename,
        context.req.raw.body,
        Number(context.req.header('content-length') ?? 0),
      ),
    );
  });
}
