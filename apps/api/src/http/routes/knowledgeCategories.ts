/**
 * 知识类别 HTTP 适配器。
 *
 * 校验目录维护与活动 revision 分类请求，业务逻辑委托给类别服务。
 *
 * Responsibilities:
 * - 保留路径和 JSON 的运行时校验。
 *
 * Notes:
 * - 不提供类别硬删除或任意知识库访问入口。
 */
import {
  KnowledgeCategoryCreateSchema,
  KnowledgeCategoryUpdateSchema,
  DocumentClassificationUpdateSchema,
} from '@echowave/contracts';
import type { Hono } from 'hono';
import type { KnowledgeCategoryService } from '../../knowledge/categories/categoryService.ts';
import { entityId } from '../response.ts';
/** 注册租户类别目录及文档分类管理接口。 */
export function registerKnowledgeCategoryRoutes(app: Hono, service: KnowledgeCategoryService) {
  app.get('/api/knowledge-categories', async (c) => c.json(await service.list()));
  app.get('/api/knowledge-bases/:knowledgeBaseId/categories', async (c) =>
    c.json(await service.available(entityId(c.req.param('knowledgeBaseId')))),
  );
  app.post('/api/knowledge-categories', async (c) =>
    c.json(await service.create(KnowledgeCategoryCreateSchema.parse(await c.req.json())), 201),
  );
  app.patch('/api/knowledge-categories/:categoryId', async (c) =>
    c.json(
      await service.update(
        entityId(c.req.param('categoryId')),
        KnowledgeCategoryUpdateSchema.parse(await c.req.json()),
      ),
    ),
  );
  const route = '/api/knowledge-bases/:knowledgeBaseId/documents/:documentId/classification';
  app.get(route, async (c) =>
    c.json(
      await service.getClassification(
        entityId(c.req.param('knowledgeBaseId')),
        entityId(c.req.param('documentId')),
      ),
    ),
  );
  app.patch(route, async (c) =>
    c.json(
      await service.updateClassification(
        entityId(c.req.param('knowledgeBaseId')),
        entityId(c.req.param('documentId')),
        DocumentClassificationUpdateSchema.parse(await c.req.json()),
      ),
    ),
  );
  app.post(`${route}/suggest`, async (c) =>
    c.json(
      await service.suggest(
        entityId(c.req.param('knowledgeBaseId')),
        entityId(c.req.param('documentId')),
      ),
    ),
  );
}
