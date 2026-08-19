/** Defines the validated Hono transport boundary without starting a network listener. */
import {
  ApiErrorResponseSchema,
  EntityIdSchema,
  HelloResponseSchema,
  KnowledgeBaseCreateRequestSchema,
  KnowledgeBaseUpdateRequestSchema,
  RagQueryRequestSchema,
  type ApiErrorCode,
} from '@echowave/contracts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';

import type { ApiConfig } from './env.ts';
import { UploadValidationError, type KnowledgeService } from './rag/knowledgeService.ts';
import { QueryModelError } from './rag/queryAgent.ts';
import { RagRepositoryError } from './rag/repository.ts';

type ErrorStatus = 400 | 404 | 409 | 413 | 500 | 503 | 504;

function errorBody(code: ApiErrorCode, message: string, retryable = false) {
  return ApiErrorResponseSchema.parse({ ok: false, error: { code, message, retryable } });
}

function id(value: string): string {
  return EntityIdSchema.parse(value);
}

export function createApp(
  config: Pick<ApiConfig, 'corsOrigins'>,
  dependencies: { knowledgeService?: KnowledgeService } = {},
) {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: config.corsOrigins,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    }),
  );

  app.get('/api/hello', (context) =>
    context.json(HelloResponseSchema.parse({ ok: true, service: 'echowave-api', message: 'HelloWorld' })),
  );

  const service = dependencies.knowledgeService;
  if (service) {
    app.get('/api/knowledge-bases', async (context) => context.json(await service.listKnowledgeBases()));
    app.post('/api/knowledge-bases', async (context) => {
      const input = KnowledgeBaseCreateRequestSchema.parse(await context.req.json());
      return context.json(await service.createKnowledgeBase(input), 201);
    });
    app.get('/api/knowledge-bases/:knowledgeBaseId', async (context) =>
      context.json(await service.getKnowledgeBase(id(context.req.param('knowledgeBaseId')))),
    );
    app.patch('/api/knowledge-bases/:knowledgeBaseId', async (context) => {
      const input = KnowledgeBaseUpdateRequestSchema.parse(await context.req.json());
      return context.json(await service.updateKnowledgeBase(id(context.req.param('knowledgeBaseId')), input));
    });
    app.delete('/api/knowledge-bases/:knowledgeBaseId', async (context) => {
      await service.deleteKnowledgeBase(id(context.req.param('knowledgeBaseId')));
      return context.body(null, 204);
    });

    app.get('/api/knowledge-bases/:knowledgeBaseId/documents', async (context) =>
      context.json(await service.listDocuments(id(context.req.param('knowledgeBaseId')))),
    );
    app.post('/api/knowledge-bases/:knowledgeBaseId/documents', async (context) => {
      const contentLength = Number(context.req.header('content-length') ?? 0);
      if (contentLength > 21 * 1024 * 1024) {
        return context.json(errorBody('DOCUMENT_TOO_LARGE', '单个文件不能超过 20 MB。'), 413);
      }
      const form = await context.req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return context.json(errorBody('BAD_REQUEST', '缺少文件字段 file。'), 400);
      return context.json(await service.uploadDocument(id(context.req.param('knowledgeBaseId')), file), 202);
    });
    app.get('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId', async (context) =>
      context.json(await service.getDocument(
        id(context.req.param('knowledgeBaseId')),
        id(context.req.param('documentId')),
      )),
    );
    app.delete('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId', async (context) => {
      await service.deleteDocument(id(context.req.param('knowledgeBaseId')), id(context.req.param('documentId')));
      return context.body(null, 204);
    });
    app.post('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId/retry', async (context) => {
      const knowledgeBaseId = id(context.req.param('knowledgeBaseId'));
      const documentId = id(context.req.param('documentId'));
      await service.retryDocument(knowledgeBaseId, documentId);
      return context.json(await service.getDocument(knowledgeBaseId, documentId), 202);
    });
    app.get('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId/chunks', async (context) =>
      context.json(await service.listChunks(
        id(context.req.param('knowledgeBaseId')),
        id(context.req.param('documentId')),
      )),
    );
    app.get('/api/knowledge-bases/:knowledgeBaseId/documents/:documentId/chunks/:chunkId', async (context) =>
      context.json(await service.getChunk(
        id(context.req.param('knowledgeBaseId')),
        id(context.req.param('documentId')),
        id(context.req.param('chunkId')),
      )),
    );
    app.post('/api/knowledge-bases/:knowledgeBaseId/query', async (context) => {
      const input = RagQueryRequestSchema.parse(await context.req.json());
      return context.json(await service.query(id(context.req.param('knowledgeBaseId')), input));
    });
  }

  app.notFound((context) => context.json(errorBody('NOT_FOUND', 'Route not found.'), 404));

  app.onError((error, context) => {
    let status: ErrorStatus = 500;
    let code: ApiErrorCode = 'INTERNAL_ERROR';
    let message = '服务暂时无法完成请求。';
    let retryable = false;
    if (error instanceof ZodError || (error instanceof SyntaxError && error.message.includes('JSON'))) {
      status = 400;
      code = 'BAD_REQUEST';
      message = '请求参数无效。';
    } else if (error instanceof RagRepositoryError) {
      status = error.code === 'NOT_FOUND' ? 404 : 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof UploadValidationError) {
      status = error.code === 'DOCUMENT_TOO_LARGE' ? 413 : 400;
      code = error.code;
      message = error.message;
    } else if (error instanceof QueryModelError) {
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

export type EchoWaveApp = ReturnType<typeof createApp>;
