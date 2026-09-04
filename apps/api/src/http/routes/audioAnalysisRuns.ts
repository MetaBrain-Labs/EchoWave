/**
 * 统一分析运行记录 HTTP 路由。
 *
 * 暴露批次与手动音频分析的只读聚合列表，移动端据此展示运行历史和恢复入口。
 *
 * Responsibilities:
 * - 解析 URL 查询参数并调用运行记录服务。
 * - 保持响应通过共享 Zod 契约校验。
 */
import type { Hono } from 'hono';

import type { AudioAnalysisRunsService } from '../../workspace/audio/analysis-runs/service.ts';

/** 注册统一分析列表端点。 */
export function registerAudioAnalysisRunsRoutes(
  app: Hono,
  service: AudioAnalysisRunsService,
): void {
  app.get('/api/audio-analysis-runs', async (context) =>
    context.json(
      await service.list({
        status: context.req.query('status'),
        kind: context.req.query('kind'),
        limit: context.req.query('limit'),
      }),
    ),
  );
}
