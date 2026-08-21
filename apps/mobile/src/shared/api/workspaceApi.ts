/**
 * 音频工作区移动端传输适配器。
 *
 * 统一请求分组生命周期、数据源、音频和分析接口，并在客户端信任边界解析共享契约。
 *
 * Responsibilities:
 * - 提供跨 feature 复用的工作区读写函数。
 * - 将网络、超时和非法响应转换为稳定错误。
 *
 * Notes:
 * - 本模块不保存服务器数据，也不提供真实上传或分析操作。
 */
import {
  ApiErrorResponseSchema,
  AudioAnalysisDetailSchema,
  AudioFileListResponseSchema,
  DataSourceDetailSchema,
  DataSourceIngestionListResponseSchema,
  DataSourceListResponseSchema,
  GroupCreateRequestSchema,
  GroupDetailSchema,
  GroupListResponseSchema,
  KnowledgeBaseListResponseSchema,
  KnowledgeBaseGroupLinkRequestSchema,
  LinkedDataSourceGroupListResponseSchema,
  type GroupCreateRequest,
  type KnowledgeBaseGroupLinkRequest,
} from '@echowave/contracts';

import { apiUrl } from './apiUrl';

/** 工作区读写请求的稳定客户端错误。 */
export class WorkspaceRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) {
    super(message);
    this.name = 'WorkspaceRequestError';
  }
}

type RuntimeSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

type RequestOptions = {
  body?: unknown;
  method?: 'GET' | 'POST' | 'DELETE';
};

async function request<T>(path: string, schema: RuntimeSchema<T>, options?: RequestOptions): Promise<T>;
async function request(path: string, schema: null, options: RequestOptions): Promise<void>;
async function request<T>(path: string, schema: RuntimeSchema<T> | null, options: RequestOptions = {}): Promise<T | void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      method: options.method ?? 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const parsedError = ApiErrorResponseSchema.safeParse(body);
      throw new WorkspaceRequestError(
        parsedError.success ? parsedError.data.error.code : response.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
        parsedError.success
          ? parsedError.data.error.message
          : response.status === 404 ? '请求的数据不存在。' : `请求失败（HTTP ${response.status}）。`,
        parsedError.success ? parsedError.data.error.retryable : response.status >= 500,
      );
    }
    if (response.status === 204) {
      if (schema === null) return;
      throw new WorkspaceRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。');
    }
    const body: unknown = await response.json();
    if (schema === null) throw new WorkspaceRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。');
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new WorkspaceRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。');
    return parsed.data;
  } catch (error) {
    if (error instanceof WorkspaceRequestError) throw error;
    if (controller.signal.aborted) throw new WorkspaceRequestError('TIMEOUT', '请求超时，请重试。', true);
    throw new WorkspaceRequestError('NETWORK', '无法连接服务，请检查网络。', true);
  } finally {
    clearTimeout(timeout);
  }
}

export const listGroups = () => request('/api/groups', GroupListResponseSchema);
export const createGroup = (input: GroupCreateRequest) => {
  const body = GroupCreateRequestSchema.parse(input);
  return request('/api/groups', GroupDetailSchema, { body, method: 'POST' });
};
export const archiveGroup = (id: string) => request(`/api/groups/${id}`, null, { method: 'DELETE' });
export const getGroup = (id: string) => request(`/api/groups/${id}`, GroupDetailSchema);
export const listGroupAudioFiles = (id: string) =>
  request(`/api/groups/${id}/audio-files`, AudioFileListResponseSchema);
export const listGroupKnowledgeBases = (id: string) =>
  request(`/api/groups/${id}/knowledge-bases`, KnowledgeBaseListResponseSchema);
export const listKnowledgeBaseGroups = (id: string) =>
  request(`/api/knowledge-bases/${id}/groups`, GroupListResponseSchema);
export const linkKnowledgeBaseGroups = (id: string, input: KnowledgeBaseGroupLinkRequest) => {
  const body = KnowledgeBaseGroupLinkRequestSchema.parse(input);
  return request(`/api/knowledge-bases/${id}/groups`, GroupListResponseSchema, { body, method: 'POST' });
};
export const listGroupDataSources = (id: string) =>
  request(`/api/groups/${id}/data-sources`, DataSourceListResponseSchema);
export const listDataSources = () => request('/api/data-sources', DataSourceListResponseSchema);
export const getDataSource = (id: string) => request(`/api/data-sources/${id}`, DataSourceDetailSchema);
export const listDataSourceAudioFiles = (id: string) =>
  request(`/api/data-sources/${id}/audio-files`, AudioFileListResponseSchema);
export const listDataSourceIngestionRecords = (id: string) =>
  request(`/api/data-sources/${id}/ingestion-records`, DataSourceIngestionListResponseSchema);
export const listDataSourceGroups = (id: string) =>
  request(`/api/data-sources/${id}/groups`, LinkedDataSourceGroupListResponseSchema);
export const getAudioAnalysis = (id: string) =>
  request(`/api/audio-files/${id}/analysis`, AudioAnalysisDetailSchema);
