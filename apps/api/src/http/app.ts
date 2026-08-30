/**
 * Hono HTTP 传输入口。
 *
 * 负责路由注册、共享契约校验、跨域策略与稳定错误映射，但不启动网络监听器，
 * 也不承载知识库业务实现。
 *
 * Responsibilities:
 * - 将 HTTP 请求转换为知识库应用接口调用。
 * - 使用共享 Zod 契约验证输入与输出。
 * - 将领域错误映射为紧凑且不泄密的响应。
 *
 * Notes:
 * - 网络监听和资源生命周期由 server/runtime 负责。
 */
import {
  ApiErrorResponseSchema,
  AudioBusinessAnalysisStartRequestSchema,
  AudioAnalysisStatusStreamEventSchema,
  AudioBusinessAnalysisLiveStateSchema,
  AudioTranscriptConfirmationRequestSchema,
  AudioTranscriptionStartRequestSchema,
  DataSourceCreateRequestSchema,
  DataSourceAudioStreamEventSchema,
  DataSourceGroupLinkRequestSchema,
  DataSourceUpdateRequestSchema,
  EntityIdSchema,
  GroupCreateRequestSchema,
  GroupResourceLinksUpdateRequestSchema,
  GroupSettingsUpdateRequestSchema,
  HelloResponseSchema,
  KnowledgeBaseCreateRequestSchema,
  KnowledgeBaseGroupLinkRequestSchema,
  KnowledgeBaseUpdateRequestSchema,
  KnowledgeDocumentStreamEventSchema,
  RagQueryRequestSchema,
  type ApiErrorCode,
  type AudioAnalysisDetail,
} from '@echowave/contracts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { stream, streamSSE } from 'hono/streaming';
import { createReadStream } from 'node:fs';
import { ZodError } from 'zod';

import type { ApiConfig } from '../config/env.ts';
import { LiveUpdateBroker } from '../infrastructure/liveUpdateBroker.ts';
import { KnowledgeAnswerError } from '../knowledge/answer/knowledgeAnswer.ts';
import { RagRepositoryError } from '../knowledge/persistence/errors.ts';
import { UploadValidationError, type KnowledgeService } from '../knowledge/service.ts';
import { WorkspaceRepositoryError } from '../workspace/persistence/errors.ts';
import { AudioUploadValidationError, type WorkspaceService } from '../workspace/service.ts';
import {
  DashScopeCallbackError,
  type DashScopeCallbackService,
} from '../workspace/transcription/dashScopeCallback.ts';
import { resolveAudioByteRange } from './audioContent.ts';

type ErrorStatus = 400 | 404 | 409 | 413 | 500 | 503 | 504;

function errorBody(code: ApiErrorCode, message: string, retryable = false) {
  return ApiErrorResponseSchema.parse({ ok: false, error: { code, message, retryable } });
}

function id(value: string): string {
  return EntityIdSchema.parse(value);
}

let liveCursor = BigInt(Date.now()) * 1_000n;

/** 为非持久实时事件生成单进程递增标识；重连恢复仍以数据库快照为准。 */
function nextLiveCursor(): string {
  liveCursor += 1n;
  return liveCursor.toString();
}

function occurredAt(): string {
  return new Date().toISOString();
}

function analysisLiveState(detail: AudioAnalysisDetail) {
  return {
    emotion: detail.postAnalysis.emotion,
    role: detail.postAnalysis.role,
    business: AudioBusinessAnalysisLiveStateSchema.parse(detail.businessAnalysis),
  };
}

/** 创建不启动监听器的 Hono 应用，使生产服务器和测试通过同一传输接口调用业务模块。 */
export function createApp(
  config: Pick<ApiConfig, 'corsOrigins'>,
  dependencies: {
    dashScopeCallbackService?: DashScopeCallbackService;
    knowledgeService?: KnowledgeService;
    workspaceService?: WorkspaceService;
    liveUpdateBroker?: LiveUpdateBroker;
  } = {},
) {
  const app = new Hono();
  const liveUpdates = dependencies.liveUpdateBroker ?? new LiveUpdateBroker();

  app.use(
    '*',
    cors({
      origin: config.corsOrigins,
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Range'],
      exposeHeaders: ['Accept-Ranges', 'Content-Length', 'Content-Range', 'Last-Modified'],
    }),
  );

  app.get('/api/hello', (context) =>
    context.json(
      HelloResponseSchema.parse({ ok: true, service: 'echowave-api', message: 'HelloWorld' }),
    ),
  );

  if (dependencies.dashScopeCallbackService) {
    app.post('/api/webhooks/dashscope/async-task-finished', async (context) => {
      const rawBody = await context.req.text();
      try {
        await dependencies.dashScopeCallbackService!.receive(rawBody, context.req.raw.headers);
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

  const service = dependencies.knowledgeService;
  if (service) {
    app.get('/api/knowledge-bases', async (context) =>
      context.json(await service.listKnowledgeBases()),
    );
    app.post('/api/knowledge-bases', async (context) => {
      const input = KnowledgeBaseCreateRequestSchema.parse(await context.req.json());
      return context.json(await service.createKnowledgeBase(input), 201);
    });
    app.get('/api/knowledge-bases/:knowledgeBaseId', async (context) =>
      context.json(await service.getKnowledgeBase(id(context.req.param('knowledgeBaseId')))),
    );
    app.patch('/api/knowledge-bases/:knowledgeBaseId', async (context) => {
      const input = KnowledgeBaseUpdateRequestSchema.parse(await context.req.json());
      return context.json(
        await service.updateKnowledgeBase(id(context.req.param('knowledgeBaseId')), input),
      );
    });
    app.delete('/api/knowledge-bases/:knowledgeBaseId', async (context) => {
      await service.deleteKnowledgeBase(id(context.req.param('knowledgeBaseId')));
      return context.body(null, 204);
    });

    app.get('/api/knowledge-bases/:knowledgeBaseId/documents', async (context) =>
      context.json(await service.listDocuments(id(context.req.param('knowledgeBaseId')))),
    );
    app.get('/api/knowledge-bases/:knowledgeBaseId/documents/stream', async (context) => {
      const knowledgeBaseId = id(context.req.param('knowledgeBaseId'));
      const subscription = liveUpdates.subscribe(
        (event) => event.kind === 'knowledge-document' && event.knowledgeBaseId === knowledgeBaseId,
      );
      let snapshot;
      try {
        snapshot = await service.listDocuments(knowledgeBaseId);
      } catch (error) {
        subscription.close();
        throw error;
      }
      context.header('Cache-Control', 'private, no-cache, no-transform');
      context.header('Content-Encoding', 'Identity');
      context.header('X-Accel-Buffering', 'no');
      return streamSSE(context, async (eventStream) => {
        try {
          const initial = KnowledgeDocumentStreamEventSchema.parse({
            type: 'snapshot',
            cursor: nextLiveCursor(),
            occurredAt: occurredAt(),
            knowledgeBaseId,
            items: snapshot.items,
          });
          await eventStream.writeSSE({
            id: initial.cursor,
            event: initial.type,
            data: JSON.stringify(initial),
          });
          while (!eventStream.aborted) {
            const signal = await subscription.wait(15_000);
            if (!signal) {
              const heartbeat = KnowledgeDocumentStreamEventSchema.parse({
                type: 'heartbeat',
                cursor: nextLiveCursor(),
                occurredAt: occurredAt(),
              });
              await eventStream.writeSSE({
                id: heartbeat.cursor,
                event: heartbeat.type,
                data: JSON.stringify(heartbeat),
              });
              continue;
            }
            if (signal.kind !== 'knowledge-document') continue;
            const documents = await service.listDocuments(knowledgeBaseId);
            const item =
              documents.items.find((document) => document.id === signal.documentId) ?? null;
            const update = KnowledgeDocumentStreamEventSchema.parse({
              type: 'document',
              cursor: nextLiveCursor(),
              occurredAt: occurredAt(),
              knowledgeBaseId,
              item,
              terminal: signal.terminal,
            });
            await eventStream.writeSSE({
              id: update.cursor,
              event: update.type,
              data: JSON.stringify(update),
            });
          }
        } catch {
          if (!eventStream.aborted) {
            const failure = KnowledgeDocumentStreamEventSchema.parse({
              type: 'error',
              cursor: nextLiveCursor(),
              occurredAt: occurredAt(),
              error: {
                code: 'STREAM_UNAVAILABLE',
                message: '文档实时状态暂时不可用。',
                retryable: true,
              },
            });
            await eventStream.writeSSE({
              id: failure.cursor,
              event: failure.type,
              data: JSON.stringify(failure),
            });
          }
        } finally {
          subscription.close();
        }
      });
    });
    app.post('/api/knowledge-bases/:knowledgeBaseId/documents', async (context) => {
      const contentLength = Number(context.req.header('content-length') ?? 0);
      if (contentLength > 21 * 1024 * 1024) {
        return context.json(errorBody('DOCUMENT_TOO_LARGE', '单个文件不能超过 20 MB。'), 413);
      }
      const form = await context.req.formData();
      const file = form.get('file');
      if (!(file instanceof File))
        return context.json(errorBody('BAD_REQUEST', '缺少文件字段 file。'), 400);
      return context.json(
        await service.uploadDocument(id(context.req.param('knowledgeBaseId')), file),
        202,
      );
    });
    app.get('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId', async (context) =>
      context.json(
        await service.getDocument(
          id(context.req.param('knowledgeBaseId')),
          id(context.req.param('documentId')),
        ),
      ),
    );
    app.delete('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId', async (context) => {
      await service.deleteDocument(
        id(context.req.param('knowledgeBaseId')),
        id(context.req.param('documentId')),
      );
      return context.body(null, 204);
    });
    app.post(
      '/api/knowledge-bases/:knowledgeBaseId/documents/:documentId/retry',
      async (context) => {
        const knowledgeBaseId = id(context.req.param('knowledgeBaseId'));
        const documentId = id(context.req.param('documentId'));
        await service.retryDocument(knowledgeBaseId, documentId);
        return context.json(await service.getDocument(knowledgeBaseId, documentId), 202);
      },
    );
    app.get('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId/chunks', async (context) =>
      context.json(
        await service.listChunks(
          id(context.req.param('knowledgeBaseId')),
          id(context.req.param('documentId')),
        ),
      ),
    );
    app.get(
      '/api/knowledge-bases/:knowledgeBaseId/documents/:documentId/chunks/:chunkId',
      async (context) =>
        context.json(
          await service.getChunk(
            id(context.req.param('knowledgeBaseId')),
            id(context.req.param('documentId')),
            id(context.req.param('chunkId')),
          ),
        ),
    );
    app.get('/api/knowledge-bases/:knowledgeBaseId/query-history', async (context) =>
      context.json(await service.listQueryHistory(id(context.req.param('knowledgeBaseId')))),
    );
    app.post('/api/knowledge-bases/:knowledgeBaseId/query', async (context) => {
      const input = RagQueryRequestSchema.parse(await context.req.json());
      return context.json(await service.query(id(context.req.param('knowledgeBaseId')), input));
    });
  }

  const workspace = dependencies.workspaceService;
  if (workspace) {
    app.get('/api/knowledge-bases/:knowledgeBaseId/groups', async (context) =>
      context.json(
        await workspace.listKnowledgeBaseGroups(id(context.req.param('knowledgeBaseId'))),
      ),
    );
    app.post('/api/knowledge-bases/:knowledgeBaseId/groups', async (context) => {
      const input = KnowledgeBaseGroupLinkRequestSchema.parse(await context.req.json());
      return context.json(
        await workspace.linkKnowledgeBaseGroups(id(context.req.param('knowledgeBaseId')), input),
      );
    });
    app.get('/api/groups', async (context) => context.json(await workspace.listGroups()));
    app.post('/api/groups', async (context) => {
      const input = GroupCreateRequestSchema.parse(await context.req.json());
      return context.json(await workspace.createGroup(input), 201);
    });
    app.get('/api/groups/:groupId', async (context) =>
      context.json(await workspace.getGroup(id(context.req.param('groupId')))),
    );
    app.get('/api/groups/:groupId/settings', async (context) =>
      context.json(await workspace.getGroupSettings(id(context.req.param('groupId')))),
    );
    app.patch('/api/groups/:groupId/settings', async (context) => {
      const input = GroupSettingsUpdateRequestSchema.parse(await context.req.json());
      return context.json(
        await workspace.updateGroupSettings(id(context.req.param('groupId')), input),
      );
    });
    app.delete('/api/groups/:groupId', async (context) => {
      await workspace.archiveGroup(id(context.req.param('groupId')));
      return context.body(null, 204);
    });
    app.get('/api/groups/:groupId/audio-files', async (context) =>
      context.json(await workspace.listGroupAudioFiles(id(context.req.param('groupId')))),
    );
    app.get('/api/groups/:groupId/knowledge-bases', async (context) =>
      context.json(await workspace.listGroupKnowledgeBases(id(context.req.param('groupId')))),
    );
    app.put('/api/groups/:groupId/knowledge-bases', async (context) => {
      const input = GroupResourceLinksUpdateRequestSchema.parse(await context.req.json());
      return context.json(
        await workspace.replaceGroupKnowledgeBases(id(context.req.param('groupId')), input),
      );
    });
    app.get('/api/groups/:groupId/data-sources', async (context) =>
      context.json(await workspace.listGroupDataSources(id(context.req.param('groupId')))),
    );
    app.put('/api/groups/:groupId/data-sources', async (context) => {
      const input = GroupResourceLinksUpdateRequestSchema.parse(await context.req.json());
      return context.json(
        await workspace.replaceGroupDataSources(id(context.req.param('groupId')), input),
      );
    });
    app.get('/api/data-sources', async (context) =>
      context.json(await workspace.listDataSources()),
    );
    app.post('/api/data-sources', async (context) => {
      const input = DataSourceCreateRequestSchema.parse(await context.req.json());
      return context.json(await workspace.createDataSource(input), 201);
    });
    app.get('/api/data-sources/:dataSourceId', async (context) =>
      context.json(await workspace.getDataSource(id(context.req.param('dataSourceId')))),
    );
    app.patch('/api/data-sources/:dataSourceId', async (context) => {
      const input = DataSourceUpdateRequestSchema.parse(await context.req.json());
      return context.json(
        await workspace.updateDataSource(id(context.req.param('dataSourceId')), input),
      );
    });
    app.delete('/api/data-sources/:dataSourceId', async (context) => {
      await workspace.archiveDataSource(id(context.req.param('dataSourceId')));
      return context.body(null, 204);
    });
    app.get('/api/data-sources/:dataSourceId/audio-files', async (context) =>
      context.json(await workspace.listDataSourceAudioFiles(id(context.req.param('dataSourceId')))),
    );
    app.get('/api/data-sources/:dataSourceId/audio-files/stream', async (context) => {
      const dataSourceId = id(context.req.param('dataSourceId'));
      const subscription = liveUpdates.subscribe(
        (event) => event.kind === 'data-source-audio' && event.dataSourceId === dataSourceId,
      );
      let snapshot;
      try {
        snapshot = await workspace.listDataSourceAudioFiles(dataSourceId);
      } catch (error) {
        subscription.close();
        throw error;
      }
      context.header('Cache-Control', 'private, no-cache, no-transform');
      context.header('Content-Encoding', 'Identity');
      context.header('X-Accel-Buffering', 'no');
      return streamSSE(context, async (eventStream) => {
        try {
          const initial = DataSourceAudioStreamEventSchema.parse({
            type: 'snapshot',
            cursor: nextLiveCursor(),
            occurredAt: occurredAt(),
            dataSourceId,
            items: snapshot.items,
          });
          await eventStream.writeSSE({
            id: initial.cursor,
            event: initial.type,
            data: JSON.stringify(initial),
          });
          while (!eventStream.aborted) {
            const signal = await subscription.wait(15_000);
            if (!signal) {
              const heartbeat = DataSourceAudioStreamEventSchema.parse({
                type: 'heartbeat',
                cursor: nextLiveCursor(),
                occurredAt: occurredAt(),
              });
              await eventStream.writeSSE({
                id: heartbeat.cursor,
                event: heartbeat.type,
                data: JSON.stringify(heartbeat),
              });
              continue;
            }
            if (signal.kind !== 'data-source-audio') continue;
            const audioFiles = await workspace.listDataSourceAudioFiles(dataSourceId);
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
            await eventStream.writeSSE({
              id: update.cursor,
              event: update.type,
              data: JSON.stringify(update),
            });
            if (signal.terminal) {
              const refresh = DataSourceAudioStreamEventSchema.parse({
                type: 'refresh',
                cursor: nextLiveCursor(),
                occurredAt: occurredAt(),
                dataSourceId,
              });
              await eventStream.writeSSE({
                id: refresh.cursor,
                event: refresh.type,
                data: JSON.stringify(refresh),
              });
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
            await eventStream.writeSSE({
              id: failure.cursor,
              event: failure.type,
              data: JSON.stringify(failure),
            });
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
        await workspace.uploadDataSourceAudioFiles(id(context.req.param('dataSourceId')), files),
        201,
      );
    });
    app.delete('/api/data-sources/:dataSourceId/audio-files/:audioFileId', async (context) => {
      await workspace.archiveDataSourceAudioFile(
        id(context.req.param('dataSourceId')),
        id(context.req.param('audioFileId')),
      );
      return context.body(null, 204);
    });
    app.get('/api/data-sources/:dataSourceId/ingestion-records', async (context) =>
      context.json(
        await workspace.listDataSourceIngestionRecords(id(context.req.param('dataSourceId'))),
      ),
    );
    app.get('/api/data-sources/:dataSourceId/groups', async (context) =>
      context.json(await workspace.listDataSourceGroups(id(context.req.param('dataSourceId')))),
    );
    app.post('/api/data-sources/:dataSourceId/groups', async (context) => {
      const input = DataSourceGroupLinkRequestSchema.parse(await context.req.json());
      return context.json(
        await workspace.linkDataSourceGroups(id(context.req.param('dataSourceId')), input),
      );
    });
    app.delete('/api/data-sources/:dataSourceId/groups/:groupId', async (context) => {
      await workspace.unlinkDataSourceGroup(
        id(context.req.param('dataSourceId')),
        id(context.req.param('groupId')),
      );
      return context.body(null, 204);
    });
    app.get('/api/audio-files/:audioFileId/analysis', async (context) => {
      const requestedGroupId = context.req.query('groupId');
      return context.json(
        await workspace.getAudioAnalysis(
          id(context.req.param('audioFileId')),
          requestedGroupId ? id(requestedGroupId) : undefined,
        ),
      );
    });
    app.get('/api/audio-files/:audioFileId/analysis/status/stream', async (context) => {
      const audioFileId = id(context.req.param('audioFileId'));
      const requestedGroupId = context.req.query('groupId');
      const groupId = requestedGroupId ? id(requestedGroupId) : undefined;
      const subscription = liveUpdates.subscribe(
        (event) =>
          event.kind === 'audio-analysis' &&
          event.audioFileId === audioFileId &&
          (event.groupId === null || event.groupId === (groupId ?? null)),
      );
      let snapshot;
      try {
        snapshot = await workspace.getAudioAnalysis(audioFileId, groupId);
      } catch (error) {
        subscription.close();
        throw error;
      }
      context.header('Cache-Control', 'private, no-cache, no-transform');
      context.header('Content-Encoding', 'Identity');
      context.header('X-Accel-Buffering', 'no');
      return streamSSE(context, async (eventStream) => {
        try {
          const initial = AudioAnalysisStatusStreamEventSchema.parse({
            type: 'snapshot',
            cursor: nextLiveCursor(),
            occurredAt: occurredAt(),
            audioFileId,
            analysisRevisionId: snapshot.id,
            state: analysisLiveState(snapshot),
          });
          await eventStream.writeSSE({
            id: initial.cursor,
            event: initial.type,
            data: JSON.stringify(initial),
          });
          while (!eventStream.aborted) {
            const signal = await subscription.wait(15_000);
            if (!signal) {
              const heartbeat = AudioAnalysisStatusStreamEventSchema.parse({
                type: 'heartbeat',
                cursor: nextLiveCursor(),
                occurredAt: occurredAt(),
              });
              await eventStream.writeSSE({
                id: heartbeat.cursor,
                event: heartbeat.type,
                data: JSON.stringify(heartbeat),
              });
              continue;
            }
            if (signal.kind !== 'audio-analysis') continue;
            const detail = await workspace.getAudioAnalysis(audioFileId, groupId);
            const update = AudioAnalysisStatusStreamEventSchema.parse({
              type: 'analysis-status',
              cursor: nextLiveCursor(),
              occurredAt: occurredAt(),
              audioFileId,
              analysisRevisionId: detail.id,
              state: analysisLiveState(detail),
              terminal: signal.terminal,
            });
            await eventStream.writeSSE({
              id: update.cursor,
              event: update.type,
              data: JSON.stringify(update),
            });
          }
        } catch {
          if (!eventStream.aborted) {
            const failure = AudioAnalysisStatusStreamEventSchema.parse({
              type: 'error',
              cursor: nextLiveCursor(),
              occurredAt: occurredAt(),
              error: {
                code: 'STREAM_UNAVAILABLE',
                message: '分析实时状态暂时不可用。',
                retryable: true,
              },
            });
            await eventStream.writeSSE({
              id: failure.cursor,
              event: failure.type,
              data: JSON.stringify(failure),
            });
          }
        } finally {
          subscription.close();
        }
      });
    });
    app.get('/api/audio-files/:audioFileId/analysis/executions', async (context) => {
      const requestedGroupId = context.req.query('groupId');
      return context.json(
        await workspace.getAudioExecutionTrace(
          id(context.req.param('audioFileId')),
          requestedGroupId ? id(requestedGroupId) : undefined,
        ),
      );
    });
    app.get('/api/audio-files/:audioFileId/analysis/executions/stream', async (context) => {
      const audioFileId = id(context.req.param('audioFileId'));
      const requestedGroupId = context.req.query('groupId');
      const groupId = requestedGroupId ? id(requestedGroupId) : undefined;
      const requestedCursor = context.req.query('cursor');
      if (
        requestedCursor &&
        (!/^(0|[1-9]\d{0,18})$/.test(requestedCursor) ||
          BigInt(requestedCursor) > 9_223_372_036_854_775_807n)
      ) {
        return context.json(errorBody('BAD_REQUEST', '请求参数无效。'), 400);
      }
      const subscription = liveUpdates.subscribe(
        (event) => event.kind === 'audio-execution' && event.audioFileId === audioFileId,
      );
      let snapshot;
      try {
        snapshot = await workspace.getAudioExecutionStreamSnapshot(audioFileId, groupId);
      } catch (error) {
        subscription.close();
        throw error;
      }
      context.header('Cache-Control', 'private, no-cache, no-transform');
      context.header('Content-Encoding', 'Identity');
      context.header('X-Accel-Buffering', 'no');
      return streamSSE(context, async (eventStream) => {
        const canResume =
          requestedCursor !== undefined && BigInt(requestedCursor) <= BigInt(snapshot.cursor);
        let cursor = canResume ? requestedCursor : snapshot.cursor;
        let lastHeartbeatAt = Date.now();
        if (!canResume) {
          await eventStream.writeSSE({
            id: snapshot.cursor,
            event: 'snapshot',
            data: JSON.stringify(snapshot),
          });
        }
        try {
          while (!eventStream.aborted) {
            const signal = await subscription.wait(15_000);
            try {
              const events = await workspace.getAudioExecutionStreamEvents(
                audioFileId,
                snapshot.analysisRevisionId,
                groupId,
                cursor,
              );
              for (const event of events) {
                cursor = event.cursor;
                await eventStream.writeSSE({
                  id: event.cursor,
                  event: event.type,
                  data: JSON.stringify(event),
                });
              }
              if (!signal || Date.now() - lastHeartbeatAt >= 15_000) {
                lastHeartbeatAt = Date.now();
                await eventStream.writeSSE({
                  id: cursor,
                  event: 'heartbeat',
                  data: JSON.stringify({
                    type: 'heartbeat',
                    cursor,
                    audioFileId,
                    analysisRevisionId: snapshot.analysisRevisionId,
                    occurredAt: new Date().toISOString(),
                  }),
                });
              }
            } catch {
              await eventStream.writeSSE({
                id: cursor,
                event: 'error',
                data: JSON.stringify({
                  type: 'error',
                  cursor,
                  audioFileId,
                  analysisRevisionId: snapshot.analysisRevisionId,
                  error: {
                    code: 'STREAM_UNAVAILABLE',
                    message: '模型执行实时流暂时不可用。',
                    retryable: true,
                  },
                }),
              });
              break;
            }
          }
        } finally {
          subscription.close();
        }
      });
    });
    app.post('/api/audio-files/:audioFileId/business-analyses', async (context) => {
      const input = AudioBusinessAnalysisStartRequestSchema.parse(await context.req.json());
      return context.json(
        await workspace.startAudioBusinessAnalysis(id(context.req.param('audioFileId')), input),
        202,
      );
    });
    app.on(['GET', 'HEAD'], '/api/audio-files/:audioFileId/content', async (context) => {
      const file = await workspace.getAudioPlaybackFile(id(context.req.param('audioFileId')));
      const range = resolveAudioByteRange(context.req.header('range'), file.sizeBytes);
      context.header('Accept-Ranges', 'bytes');
      context.header('Cache-Control', 'private, no-store');
      context.header('Content-Type', file.mimeType);
      context.header('Last-Modified', file.lastModified.toUTCString());
      context.header(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.originalFilename)}`,
      );
      if (range.kind === 'unsatisfiable') {
        context.header('Content-Range', `bytes */${file.sizeBytes}`);
        return context.body(null, 416);
      }

      const contentLength = range.end - range.start + 1;
      context.header('Content-Length', String(contentLength));
      if (range.kind === 'partial') {
        context.header('Content-Range', `bytes ${range.start}-${range.end}/${file.sizeBytes}`);
        context.status(206);
      }
      if (context.req.method === 'HEAD') return context.body(null);

      return stream(context, async (writer) => {
        const readable = createReadStream(file.absolutePath, {
          start: range.start,
          end: range.end,
        });
        writer.onAbort(() => {
          readable.destroy();
        });
        try {
          for await (const chunk of readable) await writer.write(chunk);
        } finally {
          readable.destroy();
        }
      });
    });
    app.post('/api/audio-files/:audioFileId/transcript-confirmations', async (context) => {
      const input = AudioTranscriptConfirmationRequestSchema.parse(await context.req.json());
      return context.json(
        await workspace.confirmAudioTranscript(id(context.req.param('audioFileId')), input),
        201,
      );
    });
    app.get('/api/audio-transcription/capabilities', (context) =>
      context.json(workspace.getAudioTranscriptionCapabilities()),
    );
    app.post('/api/audio-files/:audioFileId/transcriptions', async (context) => {
      const input = AudioTranscriptionStartRequestSchema.parse(await context.req.json());
      return context.json(
        await workspace.startAudioTranscription(id(context.req.param('audioFileId')), input),
        202,
      );
    });
    app.post('/api/audio-files/:audioFileId/analysis/emotion', async (context) =>
      context.json(
        await workspace.startAudioPostAnalysis(id(context.req.param('audioFileId')), 'emotion'),
        202,
      ),
    );
    app.post('/api/audio-files/:audioFileId/analysis/role', async (context) =>
      context.json(
        await workspace.startAudioPostAnalysis(id(context.req.param('audioFileId')), 'role'),
        202,
      ),
    );
  }

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
    } else {
      console.error('Unhandled API error', error);
    }
    return context.json(errorBody(code, message, retryable), status);
  });

  return app;
}

/** EchoWave Hono 应用的推断类型。 */
export type EchoWaveApp = ReturnType<typeof createApp>;
