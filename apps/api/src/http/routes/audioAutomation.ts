/**
 * 一键式音频分析 HTTP 路由。
 *
 * 暴露批次创建、列表、详情、恢复、取消和可断线重连的 SSE 状态快照。
 *
 * Responsibilities:
 * - 在网络边界解析共享契约与 UUID。
 * - SSE 定时重新读取 PostgreSQL 权威快照，客户端断线后可回退 REST。
 */
import {
  AudioAnalysisBatchCreateRequestSchema,
  AudioAnalysisBatchStreamEventSchema,
} from '@echowave/contracts';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { AudioAutomationService } from '../../workspace/audio/automation/service.ts';
import { entityId } from '../response.ts';
import { prepareSse } from '../sse.ts';

const STREAM_REFRESH_MS = 5_000;

/** 注册音频自动分析批次端点。 */
export function registerAudioAutomationRoutes(app: Hono, service: AudioAutomationService): void {
  app.post('/api/audio-analysis-batches', async (context) =>
    context.json(
      await service.create(AudioAnalysisBatchCreateRequestSchema.parse(await context.req.json())),
      201,
    ),
  );
  app.get('/api/audio-analysis-batches', async (context) => context.json(await service.list()));
  app.get('/api/audio-analysis-batches/:batchId', async (context) =>
    context.json(await service.get(entityId(context.req.param('batchId')))),
  );
  app.post('/api/audio-analysis-batches/:batchId/resume', async (context) =>
    context.json(await service.resumeBatch(entityId(context.req.param('batchId')))),
  );
  app.post('/api/audio-analysis-tasks/:taskId/resume', async (context) =>
    context.json(await service.resumeTask(entityId(context.req.param('taskId')))),
  );
  app.post('/api/audio-analysis-batches/:batchId/cancel', async (context) =>
    context.json(await service.cancelBatch(entityId(context.req.param('batchId')))),
  );
  app.delete('/api/audio-analysis-batches/:batchId', async (context) =>
    context.json(await service.cancelBatch(entityId(context.req.param('batchId')))),
  );
  app.post('/api/audio-analysis-tasks/:taskId/cancel', async (context) =>
    context.json(await service.cancelTask(entityId(context.req.param('taskId')))),
  );
  app.delete('/api/audio-analysis-tasks/:taskId', async (context) =>
    context.json(await service.cancelTask(entityId(context.req.param('taskId')))),
  );
  app.get('/api/audio-analysis-batches/:batchId/stream', async (context) => {
    const batchId = entityId(context.req.param('batchId'));
    const initial = await service.get(batchId);
    prepareSse(context);
    return streamSSE(context, async (eventStream) => {
      let previous = JSON.stringify(initial);
      await eventStream.writeSSE({
        event: 'snapshot',
        data: JSON.stringify(
          AudioAnalysisBatchStreamEventSchema.parse({ type: 'snapshot', batch: initial }),
        ),
      });
      while (!eventStream.aborted) {
        await new Promise((resolve) => setTimeout(resolve, STREAM_REFRESH_MS));
        if (eventStream.aborted) break;
        const batch = await service.get(batchId);
        const serialized = JSON.stringify(batch);
        if (serialized !== previous) {
          previous = serialized;
          await eventStream.writeSSE({
            event: 'snapshot',
            data: JSON.stringify(
              AudioAnalysisBatchStreamEventSchema.parse({ type: 'snapshot', batch }),
            ),
          });
        } else {
          await eventStream.writeSSE({
            event: 'heartbeat',
            data: JSON.stringify(AudioAnalysisBatchStreamEventSchema.parse({ type: 'heartbeat' })),
          });
        }
      }
    });
  });
}
