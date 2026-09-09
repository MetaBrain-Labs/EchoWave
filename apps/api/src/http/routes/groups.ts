/**
 * 分组 HTTP 路由。
 *
 * 管理分组目录、设置以及知识库和数据源关联请求。
 *
 * Responsibilities:
 * - 校验分组相关路径和 JSON 输入。
 * - 将传输请求委托给工作区服务。
 *
 * Notes:
 * - 关联替换的事务语义由领域服务与 Repository 保证。
 */
import {
  GroupCreateRequestSchema,
  GroupResourceLinksUpdateRequestSchema,
  GroupSettingsUpdateRequestSchema,
  KnowledgeBaseGroupLinkRequestSchema,
  SupportedLanguageSchema,
} from '@echowave/contracts';
import type { Hono } from 'hono';

import type { GroupService } from '../../workspace/groups/service.ts';
import { entityId } from '../response.ts';

/** 注册分组与跨资源关联路由。 */
export function registerGroupRoutes(app: Hono, service: GroupService): void {
  app.get('/api/knowledge-bases/:knowledgeBaseId/groups', async (context) =>
    context.json(
      await service.listKnowledgeBaseGroups(entityId(context.req.param('knowledgeBaseId'))),
    ),
  );
  app.post('/api/knowledge-bases/:knowledgeBaseId/groups', async (context) => {
    const input = KnowledgeBaseGroupLinkRequestSchema.parse(await context.req.json());
    return context.json(
      await service.linkKnowledgeBaseGroups(entityId(context.req.param('knowledgeBaseId')), input),
    );
  });

  app.get('/api/groups', async (context) => context.json(await service.listGroups()));
  app.post('/api/groups', async (context) => {
    const input = GroupCreateRequestSchema.parse(await context.req.json());
    return context.json(await service.createGroup(input), 201);
  });
  app.get('/api/groups/:groupId/template-example', async (context) =>
    context.json(
      await service.getTemplateExample(
        entityId(context.req.param('groupId')),
        SupportedLanguageSchema.parse(context.req.query('language') ?? 'zh-CN'),
      ),
    ),
  );
  app.get('/api/groups/:groupId', async (context) =>
    context.json(await service.getGroup(entityId(context.req.param('groupId')))),
  );
  app.get('/api/groups/:groupId/settings', async (context) =>
    context.json(await service.getGroupSettings(entityId(context.req.param('groupId')))),
  );
  app.patch('/api/groups/:groupId/settings', async (context) => {
    const input = GroupSettingsUpdateRequestSchema.parse(await context.req.json());
    return context.json(
      await service.updateGroupSettings(entityId(context.req.param('groupId')), input),
    );
  });
  app.delete('/api/groups/:groupId', async (context) => {
    await service.archiveGroup(entityId(context.req.param('groupId')));
    return context.body(null, 204);
  });
  app.get('/api/groups/:groupId/audio-files', async (context) =>
    context.json(await service.listGroupAudioFiles(entityId(context.req.param('groupId')))),
  );
  app.get('/api/groups/:groupId/knowledge-bases', async (context) =>
    context.json(await service.listGroupKnowledgeBases(entityId(context.req.param('groupId')))),
  );
  app.put('/api/groups/:groupId/knowledge-bases', async (context) => {
    const input = GroupResourceLinksUpdateRequestSchema.parse(await context.req.json());
    return context.json(
      await service.replaceGroupKnowledgeBases(entityId(context.req.param('groupId')), input),
    );
  });
  app.get('/api/groups/:groupId/data-sources', async (context) =>
    context.json(await service.listGroupDataSources(entityId(context.req.param('groupId')))),
  );
  app.put('/api/groups/:groupId/data-sources', async (context) => {
    const input = GroupResourceLinksUpdateRequestSchema.parse(await context.req.json());
    return context.json(
      await service.replaceGroupDataSources(entityId(context.req.param('groupId')), input),
    );
  });
}
