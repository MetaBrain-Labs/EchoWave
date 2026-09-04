/**
 * 统一分析运行记录服务。
 *
 * 解析只读列表查询并将仓储结果固定为共享契约，供 HTTP 路由和后续实时刷新复用。
 *
 * Responsibilities:
 * - 校验状态、类型和数量筛选。
 * - 隔离传输层与 PostgreSQL 聚合细节。
 */
import { AudioAnalysisRunsQuerySchema, type AudioAnalysisRunsQuery } from '@echowave/contracts';

import type { AudioAnalysisRunsRepository } from './repository.ts';

/** 提供统一分析列表查询。 */
export class AudioAnalysisRunsService {
  constructor(private readonly repository: AudioAnalysisRunsRepository) {}

  list(rawQuery: Partial<Record<keyof AudioAnalysisRunsQuery, string | undefined>>) {
    return this.repository.list(AudioAnalysisRunsQuerySchema.parse(rawQuery));
  }
}
