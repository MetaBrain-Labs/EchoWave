/**
 * 统一分析运行记录 API 客户端。
 *
 * 读取自动批次和手动音频分析的聚合状态，供分析工作区筛选、刷新和导航使用。
 *
 * Responsibilities:
 * - 构造状态/类型筛选查询。
 * - 在移动端边界校验共享响应契约。
 */
import {
  AudioAnalysisRunsQuerySchema,
  AudioAnalysisRunsResponseSchema,
  type AudioAnalysisRunsQuery,
} from '@echowave/contracts';

import { request } from './request';

/** 查询统一分析运行记录。 */
export function listAudioAnalysisRuns(query: Partial<AudioAnalysisRunsQuery> = {}) {
  const parsed = AudioAnalysisRunsQuerySchema.parse(query);
  const params = new URLSearchParams({
    status: parsed.status,
    kind: parsed.kind,
    limit: String(parsed.limit),
  });
  return request(`/api/audio-analysis-runs?${params.toString()}`, AudioAnalysisRunsResponseSchema);
}
