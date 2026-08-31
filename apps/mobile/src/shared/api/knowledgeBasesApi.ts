/**
 * 知识库资源客户端。
 *
 * 封装知识库列表与分组关联接口。
 *
 * Responsibilities:
 * - 读取知识库集合。
 * - 管理知识库到分组的关联。
 *
 * Notes:
 * - 知识库问答流由独立流式客户端负责。
 */
import {
  GroupListResponseSchema,
  KnowledgeBaseGroupLinkRequestSchema,
  KnowledgeBaseListResponseSchema,
  type KnowledgeBaseGroupLinkRequest,
} from '@echowave/contracts';

import { request } from './request';

export const listKnowledgeBases = () =>
  request('/api/knowledge-bases', KnowledgeBaseListResponseSchema);
export const listKnowledgeBaseGroups = (id: string) =>
  request(`/api/knowledge-bases/${id}/groups`, GroupListResponseSchema);
export const linkKnowledgeBaseGroups = (id: string, input: KnowledgeBaseGroupLinkRequest) =>
  request(`/api/knowledge-bases/${id}/groups`, GroupListResponseSchema, {
    body: KnowledgeBaseGroupLinkRequestSchema.parse(input),
    method: 'POST',
  });
