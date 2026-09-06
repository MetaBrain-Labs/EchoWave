/**
 * 分组资源客户端。
 *
 * 封装分组生命周期、设置及其资源关联接口。
 *
 * Responsibilities:
 * - 校验分组写入参数。
 * - 解析分组及关联资源响应。
 *
 * Notes:
 * - 知识库自身的分组反向关联由 knowledgeBasesApi 管理。
 */
import {
  AudioFileListResponseSchema,
  DataSourceListResponseSchema,
  GroupCreateRequestSchema,
  GroupDetailSchema,
  GroupListResponseSchema,
  GroupResourceLinksUpdateRequestSchema,
  GroupSettingsSchema,
  GroupSettingsUpdateRequestSchema,
  KnowledgeBaseListResponseSchema,
  TemplateExampleSchema,
  type GroupCreateRequest,
  type GroupResourceLinksUpdateRequest,
  type GroupSettingsUpdateRequest,
} from '@echowave/contracts';

import { request } from './request';

export const listGroups = () => request('/api/groups', GroupListResponseSchema);
export const createGroup = (input: GroupCreateRequest) =>
  request('/api/groups', GroupDetailSchema, {
    body: GroupCreateRequestSchema.parse(input),
    method: 'POST',
  });
export const archiveGroup = (id: string) =>
  request(`/api/groups/${id}`, null, { method: 'DELETE' });
export const getGroup = (id: string) => request(`/api/groups/${id}`, GroupDetailSchema);
export const getGroupTemplateExample = (id: string) =>
  request(`/api/groups/${id}/template-example`, TemplateExampleSchema);
export const getGroupSettings = (id: string) =>
  request(`/api/groups/${id}/settings`, GroupSettingsSchema);
export const updateGroupSettings = (id: string, input: GroupSettingsUpdateRequest) =>
  request(`/api/groups/${id}/settings`, GroupSettingsSchema, {
    body: GroupSettingsUpdateRequestSchema.parse(input),
    method: 'PATCH',
  });
export const listGroupAudioFiles = (id: string) =>
  request(`/api/groups/${id}/audio-files`, AudioFileListResponseSchema);
export const listGroupKnowledgeBases = (id: string) =>
  request(`/api/groups/${id}/knowledge-bases`, KnowledgeBaseListResponseSchema);
export const replaceGroupKnowledgeBases = (id: string, input: GroupResourceLinksUpdateRequest) =>
  request(`/api/groups/${id}/knowledge-bases`, KnowledgeBaseListResponseSchema, {
    body: GroupResourceLinksUpdateRequestSchema.parse(input),
    method: 'PUT',
  });
export const listGroupDataSources = (id: string) =>
  request(`/api/groups/${id}/data-sources`, DataSourceListResponseSchema);
export const replaceGroupDataSources = (id: string, input: GroupResourceLinksUpdateRequest) =>
  request(`/api/groups/${id}/data-sources`, DataSourceListResponseSchema, {
    body: GroupResourceLinksUpdateRequestSchema.parse(input),
    method: 'PUT',
  });
