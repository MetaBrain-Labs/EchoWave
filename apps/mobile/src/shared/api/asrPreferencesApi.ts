/**
 * ASR 默认增强配置客户端。
 *
 * 读取租户共享默认上下文，并通过管理员口令保存通用设置。
 *
 * Responsibilities:
 * - 在移动端信任边界解析 ASR 默认上下文响应。
 * - 保持管理员保存请求的授权信息仅存在于当前操作内。
 *
 * Notes:
 * - 数据源热词由 dataSourcesApi 单独维护。
 */
import {
  AsrPreferenceSchema,
  AsrPreferenceUpdateRequestSchema,
  type AsrPreference,
} from '@echowave/contracts';

import { request } from './request';

export const getAsrPreferences = () => request('/api/asr-preferences', AsrPreferenceSchema);

export const updateAsrPreferences = (
  input: { defaultContext: string; expectedRevision: number },
  adminToken: string,
): Promise<AsrPreference> =>
  request('/api/settings/asr-preferences', AsrPreferenceSchema, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: AsrPreferenceUpdateRequestSchema.parse(input),
  });
