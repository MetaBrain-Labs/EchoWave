/**
 * 知识库 HTTP 路由。
 *
 * 将知识库、文档、文本块、问答与文档实时状态请求适配到 KnowledgeService。
 *
 * Responsibilities:
 * - 校验知识领域的路径、JSON 和 multipart 输入。
 * - 维护文档状态 SSE 的快照、心跳、更新与释放生命周期。
 *
 * Notes:
 * - 业务规则和持久化不在传输层实现。
 */
import {
  KnowledgeBaseCreateRequestSchema,
  KnowledgeBaseUpdateRequestSchema,
  KnowledgeDocumentStreamEventSchema,
  RagQueryRequestSchema,
} from '@echowave/contracts';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { LiveUpdateBroker } from '../../infrastructure/liveUpdateBroker.ts';
import type { KnowledgeService } from '../../knowledge/service.ts';
import { entityId, errorBody } from '../response.ts';
import { nextLiveCursor, occurredAt, prepareSse, writeJsonSse } from '../sse.ts';

/** 注册知识库目录、文档和问答路由。 */
export function registerKnowledgeRoutes(
  app: Hono,
  service: KnowledgeService,
  liveUpdates: LiveUpdateBroker,
): void {
  app.get('/api/knowledge-bases', async (context) =>
    context.json(await service.listKnowledgeBases()),
  );
  app.post('/api/knowledge-bases', async (context) => {
    const input = KnowledgeBaseCreateRequestSchema.parse(await context.req.json());
    return context.json(await service.createKnowledgeBase(input), 201);
  });
  app.get('/api/knowledge-bases/:knowledgeBaseId', async (context) =>
    context.json(await service.getKnowledgeBase(entityId(context.req.param('knowledgeBaseId')))),
  );
  app.patch('/api/knowledge-bases/:knowledgeBaseId', async (context) => {
    const input = KnowledgeBaseUpdateRequestSchema.parse(await context.req.json());
    return context.json(
      await service.updateKnowledgeBase(entityId(context.req.param('knowledgeBaseId')), input),
    );
  });
  app.delete('/api/knowledge-bases/:knowledgeBaseId', async (context) => {
    await service.deleteKnowledgeBase(entityId(context.req.param('knowledgeBaseId')));
    return context.body(null, 204);
  });

  app.get('/api/knowledge-bases/:knowledgeBaseId/documents', async (context) =>
    context.json(await service.listDocuments(entityId(context.req.param('knowledgeBaseId')))),
  );
  app.get('/api/knowledge-bases/:knowledgeBaseId/documents/stream', async (context) => {
    const knowledgeBaseId = entityId(context.req.param('knowledgeBaseId'));
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
    prepareSse(context);
    return streamSSE(context, async (eventStream) => {
      try {
        const initial = KnowledgeDocumentStreamEventSchema.parse({
          type: 'snapshot',
          cursor: nextLiveCursor(),
          occurredAt: occurredAt(),
          knowledgeBaseId,
          items: snapshot.items,
        });
        await writeJsonSse(eventStream, initial);
        while (!eventStream.aborted) {
          const signal = await subscription.wait(15_000);
          if (!signal) {
            const heartbeat = KnowledgeDocumentStreamEventSchema.parse({
              type: 'heartbeat',
              cursor: nextLiveCursor(),
              occurredAt: occurredAt(),
            });
            await writeJsonSse(eventStream, heartbeat);
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
          await writeJsonSse(eventStream, update);
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
          await writeJsonSse(eventStream, failure);
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
    if (!(file instanceof File)) {
      return context.json(errorBody('BAD_REQUEST', '缺少文件字段 file。'), 400);
    }
    return context.json(
      await service.uploadDocument(entityId(context.req.param('knowledgeBaseId')), file),
      202,
    );
  });
  app.get('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId', async (context) =>
    context.json(
      await service.getDocument(
        entityId(context.req.param('knowledgeBaseId')),
        entityId(context.req.param('documentId')),
      ),
    ),
  );
  app.delete('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId', async (context) => {
    await service.deleteDocument(
      entityId(context.req.param('knowledgeBaseId')),
      entityId(context.req.param('documentId')),
    );
    return context.body(null, 204);
  });
  app.post('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId/retry', async (context) => {
    const knowledgeBaseId = entityId(context.req.param('knowledgeBaseId'));
    const documentId = entityId(context.req.param('documentId'));
    await service.retryDocument(knowledgeBaseId, documentId);
    return context.json(await service.getDocument(knowledgeBaseId, documentId), 202);
  });
  app.get('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId/chunks', async (context) =>
    context.json(
      await service.listChunks(
        entityId(context.req.param('knowledgeBaseId')),
        entityId(context.req.param('documentId')),
      ),
    ),
  );
  app.get(
    '/api/knowledge-bases/:knowledgeBaseId/documents/:documentId/chunks/:chunkId',
    async (context) =>
      context.json(
        await service.getChunk(
          entityId(context.req.param('knowledgeBaseId')),
          entityId(context.req.param('documentId')),
          entityId(context.req.param('chunkId')),
        ),
      ),
  );
  app.get('/api/knowledge-bases/:knowledgeBaseId/query-history', async (context) =>
    context.json(await service.listQueryHistory(entityId(context.req.param('knowledgeBaseId')))),
  );
  app.post('/api/knowledge-bases/:knowledgeBaseId/query', async (context) => {
    const input = RagQueryRequestSchema.parse(await context.req.json());
    return context.json(await service.query(entityId(context.req.param('knowledgeBaseId')), input));
  });
}
