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
 * - 本模块不保存服务器数据；音频二进制只通过 multipart 发送到 API。
 */
import type { DocumentPickerAsset } from 'expo-document-picker';
import { Platform } from 'react-native';

import {
  ApiErrorResponseSchema,
  AudioAnalysisDetailSchema,
  AudioBusinessAnalysisStartRequestSchema,
  AudioBusinessAnalysisStartResponseSchema,
  AudioPostAnalysisStartResponseSchema,
  AudioTranscriptConfirmationRequestSchema,
  AudioTranscriptConfirmationResponseSchema,
  AudioFileListResponseSchema,
  AudioTranscriptionCapabilitiesResponseSchema,
  AudioTranscriptionStartRequestSchema,
  AudioTranscriptionStartResponseSchema,
  DataSourceAudioUploadResponseSchema,
  DataSourceCreateRequestSchema,
  DataSourceDetailSchema,
  DataSourceGroupLinkRequestSchema,
  DataSourceIngestionListResponseSchema,
  DataSourceListResponseSchema,
  DataSourceUpdateRequestSchema,
  GroupCreateRequestSchema,
  GroupDetailSchema,
  GroupListResponseSchema,
  GroupResourceLinksUpdateRequestSchema,
  GroupSettingsSchema,
  GroupSettingsUpdateRequestSchema,
  KnowledgeBaseListResponseSchema,
  KnowledgeBaseGroupLinkRequestSchema,
  LinkedDataSourceGroupListResponseSchema,
  type DataSourceCreateRequest,
  type DataSourceGroupLinkRequest,
  type DataSourceUpdateRequest,
  type GroupCreateRequest,
  type GroupResourceLinksUpdateRequest,
  type GroupSettingsUpdateRequest,
  type KnowledgeBaseGroupLinkRequest,
  type AudioTranscriptionStartRequest,
  type AudioTranscriptConfirmationRequest,
  type AudioBusinessAnalysisStartRequest,
} from '@echowave/contracts';

import { apiUrl } from './apiUrl';

/** 工作区读写请求的稳定客户端错误。 */
export class WorkspaceRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'WorkspaceRequestError';
  }
}

type RuntimeSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

type RequestOptions = {
  body?: unknown | FormData;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  timeoutMs?: number;
};

async function request<T>(
  path: string,
  schema: RuntimeSchema<T>,
  options?: RequestOptions,
): Promise<T>;
async function request(path: string, schema: null, options: RequestOptions): Promise<void>;
async function request<T>(
  path: string,
  schema: RuntimeSchema<T> | null,
  options: RequestOptions = {},
): Promise<T | void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const multipart = options.body instanceof FormData;
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      body:
        options.body === undefined
          ? undefined
          : options.body instanceof FormData
            ? options.body
            : JSON.stringify(options.body),
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }),
      },
      method: options.method ?? 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const parsedError = ApiErrorResponseSchema.safeParse(body);
      throw new WorkspaceRequestError(
        parsedError.success
          ? parsedError.data.error.code
          : response.status === 404
            ? 'NOT_FOUND'
            : 'HTTP_ERROR',
        parsedError.success
          ? parsedError.data.error.message
          : response.status === 404
            ? '请求的数据不存在。'
            : `请求失败（HTTP ${response.status}）。`,
        parsedError.success ? parsedError.data.error.retryable : response.status >= 500,
      );
    }
    if (response.status === 204) {
      if (schema === null) return;
      throw new WorkspaceRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。');
    }
    const body: unknown = await response.json();
    if (schema === null)
      throw new WorkspaceRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。');
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new WorkspaceRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。');
    return parsed.data;
  } catch (error) {
    if (error instanceof WorkspaceRequestError) throw error;
    if (controller.signal.aborted)
      throw new WorkspaceRequestError('TIMEOUT', '请求超时，请重试。', true);
    throw new WorkspaceRequestError('NETWORK', '无法连接服务，请检查网络。', true);
  } finally {
    clearTimeout(timeout);
  }
}

export const listGroups = () => request('/api/groups', GroupListResponseSchema);
export const listKnowledgeBases = () =>
  request('/api/knowledge-bases', KnowledgeBaseListResponseSchema);
export const createGroup = (input: GroupCreateRequest) => {
  const body = GroupCreateRequestSchema.parse(input);
  return request('/api/groups', GroupDetailSchema, { body, method: 'POST' });
};
export const archiveGroup = (id: string) =>
  request(`/api/groups/${id}`, null, { method: 'DELETE' });
export const getGroup = (id: string) => request(`/api/groups/${id}`, GroupDetailSchema);
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
export const listKnowledgeBaseGroups = (id: string) =>
  request(`/api/knowledge-bases/${id}/groups`, GroupListResponseSchema);
export const linkKnowledgeBaseGroups = (id: string, input: KnowledgeBaseGroupLinkRequest) => {
  const body = KnowledgeBaseGroupLinkRequestSchema.parse(input);
  return request(`/api/knowledge-bases/${id}/groups`, GroupListResponseSchema, {
    body,
    method: 'POST',
  });
};
export const listGroupDataSources = (id: string) =>
  request(`/api/groups/${id}/data-sources`, DataSourceListResponseSchema);
export const replaceGroupDataSources = (id: string, input: GroupResourceLinksUpdateRequest) =>
  request(`/api/groups/${id}/data-sources`, DataSourceListResponseSchema, {
    body: GroupResourceLinksUpdateRequestSchema.parse(input),
    method: 'PUT',
  });
export const listDataSources = () => request('/api/data-sources', DataSourceListResponseSchema);
export const createDataSource = (input: DataSourceCreateRequest) => {
  const body = DataSourceCreateRequestSchema.parse(input);
  return request('/api/data-sources', DataSourceDetailSchema, { body, method: 'POST' });
};
export const getDataSource = (id: string) =>
  request(`/api/data-sources/${id}`, DataSourceDetailSchema);
export const updateDataSource = (id: string, input: DataSourceUpdateRequest) => {
  const body = DataSourceUpdateRequestSchema.parse(input);
  return request(`/api/data-sources/${id}`, DataSourceDetailSchema, { body, method: 'PATCH' });
};
export const archiveDataSource = (id: string) =>
  request(`/api/data-sources/${id}`, null, { method: 'DELETE' });
export const listDataSourceAudioFiles = (id: string) =>
  request(`/api/data-sources/${id}/audio-files`, AudioFileListResponseSchema);
export const listDataSourceIngestionRecords = (id: string) =>
  request(`/api/data-sources/${id}/ingestion-records`, DataSourceIngestionListResponseSchema);
export const listDataSourceGroups = (id: string) =>
  request(`/api/data-sources/${id}/groups`, LinkedDataSourceGroupListResponseSchema);
export const linkDataSourceGroups = (id: string, input: DataSourceGroupLinkRequest) => {
  const body = DataSourceGroupLinkRequestSchema.parse(input);
  return request(`/api/data-sources/${id}/groups`, LinkedDataSourceGroupListResponseSchema, {
    body,
    method: 'POST',
  });
};
export const unlinkDataSourceGroup = (id: string, groupId: string) =>
  request(`/api/data-sources/${id}/groups/${groupId}`, null, { method: 'DELETE' });

/** 将 Document Picker 资产批量编码为数据源音频 multipart 请求。 */
export async function uploadDataSourceAudioFiles(id: string, assets: DocumentPickerAsset[]) {
  const form = new FormData();
  for (const asset of assets) {
    if (Platform.OS === 'web' && asset.file) {
      form.append('files', asset.file);
    } else {
      form.append('files', {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? 'application/octet-stream',
      } as unknown as Blob);
    }
  }
  return request(`/api/data-sources/${id}/audio-files`, DataSourceAudioUploadResponseSchema, {
    body: form,
    method: 'POST',
    timeoutMs: 120_000,
  });
}

export const archiveDataSourceAudioFile = (id: string, audioFileId: string) =>
  request(`/api/data-sources/${id}/audio-files/${audioFileId}`, null, { method: 'DELETE' });
export const getAudioTranscriptionCapabilities = () =>
  request('/api/audio-transcription/capabilities', AudioTranscriptionCapabilitiesResponseSchema);
export const startAudioTranscription = (id: string, input: AudioTranscriptionStartRequest) =>
  request(`/api/audio-files/${id}/transcriptions`, AudioTranscriptionStartResponseSchema, {
    body: AudioTranscriptionStartRequestSchema.parse(input),
    method: 'POST',
  });
export const getAudioAnalysis = (id: string, groupId?: string) =>
  request(
    `/api/audio-files/${id}/analysis${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ''}`,
    AudioAnalysisDetailSchema,
  );
export const startAudioBusinessAnalysis = (id: string, input: AudioBusinessAnalysisStartRequest) =>
  request(`/api/audio-files/${id}/business-analyses`, AudioBusinessAnalysisStartResponseSchema, {
    body: AudioBusinessAnalysisStartRequestSchema.parse(input),
    method: 'POST',
  });
export const confirmAudioTranscript = (id: string, input: AudioTranscriptConfirmationRequest) =>
  request(
    `/api/audio-files/${id}/transcript-confirmations`,
    AudioTranscriptConfirmationResponseSchema,
    {
      body: AudioTranscriptConfirmationRequestSchema.parse(input),
      method: 'POST',
    },
  );
export const startAudioEmotionAnalysis = (id: string) =>
  request(`/api/audio-files/${id}/analysis/emotion`, AudioPostAnalysisStartResponseSchema, {
    method: 'POST',
  });
export const startAudioRoleRecognition = (id: string) =>
  request(`/api/audio-files/${id}/analysis/role`, AudioPostAnalysisStartResponseSchema, {
    method: 'POST',
  });
