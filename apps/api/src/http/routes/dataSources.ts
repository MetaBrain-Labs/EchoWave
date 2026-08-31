/**
 * 数据源 HTTP 路由。
 *
 * 管理数据源目录、音频上传、导入记录、分组关联与音频状态实时流。
 *
 * Responsibilities:
 * - 校验数据源请求并控制上传体积边界。
 * - 维护数据源音频 SSE 快照、更新、刷新、心跳和资源释放。
 *
 * Notes:
 * - 文件内容校验与持久化由领域服务负责。
 */
import {
  DataSourceAudioStreamEventSchema,
  DataSourceCreateRequestSchema,
  DataSourceGroupLinkRequestSchema,
  DataSourceUpdateRequestSchema,
} from '@echowave/contracts';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { LiveUpdateBroker } from '../../infrastructure/liveUpdateBroker.ts';
import type { DataSourceService } from '../../workspace/data-sources/service.ts';
import { entityId, errorBody } from '../response.ts';
import { nextLiveCursor, occurredAt, prepareSse, writeJsonSse } from '../sse.ts';

/** 注册数据源及其音频集合路由。 */
export function registerDataSourceRoutes(
  app: Hono,
  service: DataSourceService,
  liveUpdates: LiveUpdateBroker,
): void {
  app.get('/api/data-sources', async (context) => context.json(await service.listDataSources()));
  app.post('/api/data-sources', async (context) => {
    const input = DataSourceCreateRequestSchema.parse(await context.req.json());
    return context.json(await service.createDataSource(input), 201);
  });
  app.get('/api/data-sources/:dataSourceId', async (context) =>
    context.json(await service.getDataSource(entityId(context.req.param('dataSourceId')))),
  );
  app.patch('/api/data-sources/:dataSourceId', async (context) => {
    const input = DataSourceUpdateRequestSchema.parse(await context.req.json());
    return context.json(
      await service.updateDataSource(entityId(context.req.param('dataSourceId')), input),
    );
  });
  app.delete('/api/data-sources/:dataSourceId', async (context) => {
    await service.archiveDataSource(entityId(context.req.param('dataSourceId')));
    return context.body(null, 204);
  });
  app.get('/api/data-sources/:dataSourceId/audio-files', async (context) =>
    context.json(
      await service.listDataSourceAudioFiles(entityId(context.req.param('dataSourceId'))),
    ),
  );
  app.get('/api/data-sources/:dataSourceId/audio-files/stream', async (context) => {
    const dataSourceId = entityId(context.req.param('dataSourceId'));
    const subscription = liveUpdates.subscribe(
      (event) => event.kind === 'data-source-audio' && event.dataSourceId === dataSourceId,
    );
    let snapshot;
    try {
      snapshot = await service.listDataSourceAudioFiles(dataSourceId);
    } catch (error) {
      subscription.close();
      throw error;
    }
    prepareSse(context);
    return streamSSE(context, async (eventStream) => {
      try {
        const initial = DataSourceAudioStreamEventSchema.parse({
          type: 'snapshot',
          cursor: nextLiveCursor(),
          occurredAt: occurredAt(),
          dataSourceId,
          items: snapshot.items,
        });
        await writeJsonSse(eventStream, initial);
        while (!eventStream.aborted) {
          const signal = await subscription.wait(15_000);
          if (!signal) {
            const heartbeat = DataSourceAudioStreamEventSchema.parse({
              type: 'heartbeat',
              cursor: nextLiveCursor(),
              occurredAt: occurredAt(),
            });
            await writeJsonSse(eventStream, heartbeat);
            continue;
          }
          if (signal.kind !== 'data-source-audio') continue;
          const audioFiles = await service.listDataSourceAudioFiles(dataSourceId);
          const item = audioFiles.items.find((audio) => audio.id === signal.audioFileId) ?? null;
          const update = DataSourceAudioStreamEventSchema.parse({
            type: 'audio-file',
            cursor: nextLiveCursor(),
            occurredAt: occurredAt(),
            dataSourceId,
            audioFileId: signal.audioFileId,
            item,
            terminal: signal.terminal,
          });
          await writeJsonSse(eventStream, update);
          if (signal.terminal) {
            const refresh = DataSourceAudioStreamEventSchema.parse({
              type: 'refresh',
              cursor: nextLiveCursor(),
              occurredAt: occurredAt(),
              dataSourceId,
            });
            await writeJsonSse(eventStream, refresh);
          }
        }
      } catch {
        if (!eventStream.aborted) {
          const failure = DataSourceAudioStreamEventSchema.parse({
            type: 'error',
            cursor: nextLiveCursor(),
            occurredAt: occurredAt(),
            error: {
              code: 'STREAM_UNAVAILABLE',
              message: '转写实时状态暂时不可用。',
              retryable: true,
            },
          });
          await writeJsonSse(eventStream, failure);
        }
      } finally {
        subscription.close();
      }
    });
  });
  app.post('/api/data-sources/:dataSourceId/audio-files', async (context) => {
    const contentLength = Number(context.req.header('content-length') ?? 0);
    if (contentLength > 201 * 1024 * 1024) {
      return context.json(errorBody('AUDIO_TOO_LARGE', '整批文件总大小不能超过 200 MB。'), 413);
    }
    const form = await context.req.formData();
    const files = form.getAll('files').filter((item): item is File => item instanceof File);
    return context.json(
      await service.uploadDataSourceAudioFiles(entityId(context.req.param('dataSourceId')), files),
      201,
    );
  });
  app.delete('/api/data-sources/:dataSourceId/audio-files/:audioFileId', async (context) => {
    await service.archiveDataSourceAudioFile(
      entityId(context.req.param('dataSourceId')),
      entityId(context.req.param('audioFileId')),
    );
    return context.body(null, 204);
  });
  app.get('/api/data-sources/:dataSourceId/ingestion-records', async (context) =>
    context.json(
      await service.listDataSourceIngestionRecords(entityId(context.req.param('dataSourceId'))),
    ),
  );
  app.get('/api/data-sources/:dataSourceId/groups', async (context) =>
    context.json(await service.listDataSourceGroups(entityId(context.req.param('dataSourceId')))),
  );
  app.post('/api/data-sources/:dataSourceId/groups', async (context) => {
    const input = DataSourceGroupLinkRequestSchema.parse(await context.req.json());
    return context.json(
      await service.linkDataSourceGroups(entityId(context.req.param('dataSourceId')), input),
    );
  });
  app.delete('/api/data-sources/:dataSourceId/groups/:groupId', async (context) => {
    await service.unlinkDataSourceGroup(
      entityId(context.req.param('dataSourceId')),
      entityId(context.req.param('groupId')),
    );
    return context.body(null, 204);
  });
}
