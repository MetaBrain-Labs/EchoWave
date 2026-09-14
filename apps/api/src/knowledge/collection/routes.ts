/**
 * 案例收集 HTTP 适配器。
 *
 * 校验规则、修正、审核和历史请求，复用 Range 语义播放独立媒体。
 *
 * Responsibilities:
 * - 在信任边界解析共享契约和路径标识。
 * - 批量审核逐项返回失败，不隐藏部分成功。
 *
 * Notes:
 * - 不在 HTTP 层访问数据库或推断业务内容。
 */
import {
  OrganizeCollectionCasesSchema,
  AnalysisCorrectionInputSchema,
  CaseActionRequestSchema,
  CaseUpdateRequestSchema,
  CaseBatchRequestSchema,
  CollectionHistoryRequestSchema,
  CollectionRuleInputSchema,
  CollectionRuleUpdateSchema,
  ManualCollectionRequestSchema,
} from '@echowave/contracts';
import type { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { entityId } from '../../http/response.ts';
import { resolveAudioByteRange } from '../../http/audioContent.ts';
import type { CollectionService } from './service.ts';

/** 注册案例业务路径，所有存储定位由服务进行租户检查。 */
export function registerCollectionRoutes(app: Hono, service: CollectionService): void {
  const repo = service.repository;
  app.get('/api/knowledge-bases/:knowledgeBaseId/directory', async (c) =>
    c.json(
      await repo.folders.directory(
        entityId(c.req.param('knowledgeBaseId')),
        z
          .string()
          .max(200)
          .parse(c.req.query('query') ?? ''),
      ),
    ),
  );
  app.get('/api/knowledge-bases/:knowledgeBaseId/collection-folders/:folderId', async (c) =>
    c.json(
      await repo.folders.contents(
        entityId(c.req.param('knowledgeBaseId')),
        entityId(c.req.param('folderId')),
        z
          .string()
          .max(200)
          .parse(c.req.query('query') ?? ''),
      ),
    ),
  );
  app.post(
    '/api/knowledge-bases/:knowledgeBaseId/collection-folders/:folderId/organize',
    async (c) =>
      c.json(
        await repo.folders.organize(
          entityId(c.req.param('knowledgeBaseId')),
          entityId(c.req.param('folderId')),
          OrganizeCollectionCasesSchema.parse(await c.req.json()),
        ),
      ),
  );
  app.get('/api/groups/:groupId/collection-rules', async (c) =>
    c.json(await repo.listRules(entityId(c.req.param('groupId')))),
  );
  app.post('/api/groups/:groupId/collection-rules', async (c) =>
    c.json(
      await repo.saveRule(
        entityId(c.req.param('groupId')),
        CollectionRuleInputSchema.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.put('/api/groups/:groupId/collection-rules/:ruleId', async (c) => {
    const { expectedVersion, ...input } = CollectionRuleUpdateSchema.parse(await c.req.json());
    return c.json(
      await repo.saveRule(
        entityId(c.req.param('groupId')),
        input,
        entityId(c.req.param('ruleId')),
        expectedVersion,
      ),
    );
  });
  app.get('/api/business-analyses/:jobId/collection', async (c) =>
    c.json(await service.capture(entityId(c.req.param('jobId')))),
  );
  app.get('/api/business-analyses/:jobId/tags/:tagId/corrections', async (c) =>
    c.json(
      await repo.listCorrections(entityId(c.req.param('jobId')), entityId(c.req.param('tagId'))),
    ),
  );
  app.post('/api/business-analyses/:jobId/tags/:tagId/corrections', async (c) =>
    c.json(
      await repo.saveCorrection(
        entityId(c.req.param('jobId')),
        entityId(c.req.param('tagId')),
        AnalysisCorrectionInputSchema.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.post('/api/knowledge-cases/collect', async (c) =>
    c.json(await service.manual(ManualCollectionRequestSchema.parse(await c.req.json())), 201),
  );
  app.get('/api/knowledge-bases/:knowledgeBaseId/cases', async (c) =>
    c.json(await repo.listCases(entityId(c.req.param('knowledgeBaseId')))),
  );
  app.get('/api/knowledge-cases/:caseId', async (c) =>
    c.json(await repo.getCase(entityId(c.req.param('caseId')))),
  );
  app.put('/api/knowledge-cases/:caseId', async (c) => {
    const input = CaseUpdateRequestSchema.parse(await c.req.json());
    return c.json(
      await service.updateCase(
        entityId(c.req.param('caseId')),
        input.expectedVersion,
        input.content,
      ),
    );
  });
  app.post('/api/knowledge-cases/:caseId/actions', async (c) => {
    const input = CaseActionRequestSchema.parse(await c.req.json());
    return c.json(
      await service.action(entityId(c.req.param('caseId')), input.expectedVersion, input.action),
    );
  });
  app.post('/api/knowledge-cases/batch-actions', async (c) => {
    const input = CaseBatchRequestSchema.parse(await c.req.json());
    const items = [];
    for (const item of input.items) {
      try {
        await service.action(item.id, item.expectedVersion, item.action);
        items.push({ id: item.id, success: true, message: null });
      } catch {
        items.push({ id: item.id, success: false, message: '操作未完成，请刷新案例状态后重试。' });
      }
    }
    return c.json({ items });
  });
  app.post('/api/groups/:groupId/collection-history/preview', async (c) =>
    c.json(
      await service.history(
        entityId(c.req.param('groupId')),
        CollectionHistoryRequestSchema.parse(await c.req.json()),
        false,
      ),
    ),
  );
  app.post('/api/groups/:groupId/collection-history', async (c) =>
    c.json(
      await service.history(
        entityId(c.req.param('groupId')),
        CollectionHistoryRequestSchema.parse(await c.req.json()),
        true,
      ),
      202,
    ),
  );
  app.get('/api/groups/:groupId/collection-runs', async (c) =>
    c.json(await repo.listRuns(entityId(c.req.param('groupId')))),
  );
  app.post('/api/groups/:groupId/collection-runs/:runId/retry', async (c) =>
    c.json(await repo.retryRun(entityId(c.req.param('groupId')), entityId(c.req.param('runId')))),
  );
  app.on(['GET', 'HEAD'], '/api/knowledge-cases/:caseId/media/:segmentId', async (c) => {
    const version = z.coerce.number().int().positive().parse(c.req.query('version'));
    const file = await service.playback(
      entityId(c.req.param('caseId')),
      version,
      entityId(c.req.param('segmentId')),
    );
    const range = resolveAudioByteRange(c.req.header('range'), file.sizeBytes);
    c.header('Accept-Ranges', 'bytes');
    c.header('Cache-Control', 'private, no-store');
    c.header('Content-Type', file.mimeType);
    c.header('Last-Modified', file.lastModified.toUTCString());
    if (range.kind === 'unsatisfiable') {
      c.header('Content-Range', `bytes */${file.sizeBytes}`);
      return c.body(null, 416);
    }
    c.header('Content-Length', String(range.end - range.start + 1));
    if (range.kind === 'partial') {
      c.header('Content-Range', `bytes ${range.start}-${range.end}/${file.sizeBytes}`);
      c.status(206);
    }
    if (c.req.method === 'HEAD') return c.body(null);
    return stream(c, async (writer) => {
      const readable = createReadStream(file.absolutePath!, { start: range.start, end: range.end });
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
}
