/**
 * ASR 默认增强配置路由。
 *
 * 提供当前租户的默认上下文读取和受管理员保护的保存入口；任务创建时仍会冻结独立快照。
 *
 * Responsibilities:
 * - 在网络边界解析上下文配置契约。
 * - 使用现有 SettingsService 管理口令保护配置修改。
 *
 * Notes:
 * - GET 不需要管理口令，以便自动任务和手动任务表单读取默认值。
 */
import { AsrPreferenceSchema, AsrPreferenceUpdateRequestSchema } from '@echowave/contracts';
import type { Hono } from 'hono';

import type { AsrPreferenceRepository } from '../../workspace/audio/transcription/asrPreferenceRepository.ts';
import type { SettingsService } from '../../settings/service.ts';

/** 注册 ASR 默认上下文的读取与管理更新路由。 */
export function registerAsrPreferenceRoutes(
  app: Hono,
  repository: AsrPreferenceRepository,
  settings: Pick<SettingsService, 'authorize'>,
): void {
  app.get('/api/asr-preferences', async (context) =>
    context.json(AsrPreferenceSchema.parse(await repository.get())),
  );
  app.put('/api/settings/asr-preferences', async (context) => {
    settings.authorize(context.req.header('authorization'));
    const input = AsrPreferenceUpdateRequestSchema.parse(await context.req.json());
    return context.json(await repository.update(input));
  });
}
