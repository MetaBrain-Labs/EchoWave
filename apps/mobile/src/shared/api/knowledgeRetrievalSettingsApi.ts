/**
 * 知识检索设置 API 客户端。
 *
 * 封装公开状态读取和管理员保护的租户级重排开关更新。
 *
 * Responsibilities:
 * - 在发送前校验乐观锁输入。
 * - 对服务端响应执行共享契约解析。
 */
import {
  KnowledgeRetrievalSettingsSchema,
  KnowledgeRetrievalSettingsUpdateRequestSchema,
  type KnowledgeRetrievalSettingsUpdateRequest,
} from '@echowave/contracts';

import { request } from './request';

export const getKnowledgeRetrievalSettings = () =>
  request('/api/knowledge-retrieval-settings', KnowledgeRetrievalSettingsSchema);

export const updateKnowledgeRetrievalSettings = (
  token: string,
  input: KnowledgeRetrievalSettingsUpdateRequest,
) =>
  request('/api/settings/knowledge-retrieval-settings', KnowledgeRetrievalSettingsSchema, {
    method: 'PUT',
    body: KnowledgeRetrievalSettingsUpdateRequestSchema.parse(input),
    headers: { Authorization: `Bearer ${token}` },
  });
