/**
 * 知识检索设置 HTTP 路由。
 *
 * 暴露公开非敏感状态，并以管理员口令保护租户级开关更新。
 *
 * Responsibilities:
 * - 在网络边界解析严格更新契约。
 * - 不返回重排 Credential 或供应商原始错误。
 */
import { KnowledgeRetrievalSettingsUpdateRequestSchema } from '@echowave/contracts';
import type { Hono } from 'hono';

import type { KnowledgeRetrievalSettingsService } from '../../knowledge/retrieval/settingsService.ts';

/** 注册知识检索设置读取与管理端点。 */
export function registerKnowledgeRetrievalSettingsRoutes(
  app: Hono,
  service: KnowledgeRetrievalSettingsService,
): void {
  app.get('/api/knowledge-retrieval-settings', async (context) =>
    context.json(await service.overview()),
  );
  app.put('/api/settings/knowledge-retrieval-settings', async (context) =>
    context.json(
      await service.update(
        context.req.header('authorization'),
        KnowledgeRetrievalSettingsUpdateRequestSchema.parse(await context.req.json()),
      ),
    ),
  );
}
