/**
 * 数据源资源客户端。
 *
 * 封装数据源生命周期、分组关联和音频上传接口。
 *
 * Responsibilities:
 * - 校验数据源写入参数。
 * - 按平台构造音频 multipart 请求。
 *
 * Notes:
 * - 音频处理和分析命令由 audioAnalysisApi 管理。
 */
import type { DocumentPickerAsset } from 'expo-document-picker';
import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';

import {
  AudioFileListResponseSchema,
  AudioUploadSessionCompleteResponseSchema,
  AudioUploadSessionCreateRequestSchema,
  AudioUploadSessionResponseSchema,
  DataSourceAudioUploadResponseSchema,
  DataSourceCreateRequestSchema,
  DataSourceDetailSchema,
  DataSourceGroupLinkRequestSchema,
  DataSourceIngestionListResponseSchema,
  DataSourceListResponseSchema,
  DataSourceUpdateRequestSchema,
  LinkedDataSourceGroupListResponseSchema,
  type DataSourceCreateRequest,
  type DataSourceGroupLinkRequest,
  type DataSourceUpdateRequest,
  type AudioRuntimeMode,
} from '@echowave/contracts';

import { apiUrl } from './apiUrl';
import { request } from './request';

export const listDataSources = () => request('/api/data-sources', DataSourceListResponseSchema);
export const createDataSource = (input: DataSourceCreateRequest) =>
  request('/api/data-sources', DataSourceDetailSchema, {
    body: DataSourceCreateRequestSchema.parse(input),
    method: 'POST',
  });
export const getDataSource = (id: string) =>
  request(`/api/data-sources/${id}`, DataSourceDetailSchema);
export const updateDataSource = (id: string, input: DataSourceUpdateRequest) =>
  request(`/api/data-sources/${id}`, DataSourceDetailSchema, {
    body: DataSourceUpdateRequestSchema.parse(input),
    method: 'PATCH',
  });
export const archiveDataSource = (id: string) =>
  request(`/api/data-sources/${id}`, null, { method: 'DELETE' });
export const listDataSourceAudioFiles = (id: string) =>
  request(`/api/data-sources/${id}/audio-files`, AudioFileListResponseSchema);
export const listDataSourceIngestionRecords = (id: string) =>
  request(`/api/data-sources/${id}/ingestion-records`, DataSourceIngestionListResponseSchema);
export const listDataSourceGroups = (id: string) =>
  request(`/api/data-sources/${id}/groups`, LinkedDataSourceGroupListResponseSchema);
export const linkDataSourceGroups = (id: string, input: DataSourceGroupLinkRequest) =>
  request(`/api/data-sources/${id}/groups`, LinkedDataSourceGroupListResponseSchema, {
    body: DataSourceGroupLinkRequestSchema.parse(input),
    method: 'POST',
  });
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

/** 按对象或轻量模式逐个创建会话并以二进制流上传，避免在 JS 内存复制整段音频。 */
export async function uploadSessionAudioFiles(
  id: string,
  assets: DocumentPickerAsset[],
  mode: Exclude<AudioRuntimeMode, 'hybrid'>,
  includeAcousticEmotion: boolean,
) {
  for (const asset of assets) {
    const sizeBytes = asset.size ?? asset.file?.size ?? new File(asset.uri).size;
    const session = await request(
      `/api/data-sources/${id}/audio-upload-sessions`,
      AudioUploadSessionResponseSchema,
      {
        method: 'POST',
        body: AudioUploadSessionCreateRequestSchema.parse({
          filename: asset.name,
          mimeType: asset.mimeType ?? 'application/octet-stream',
          sizeBytes,
          includeAcousticEmotion,
        }),
      },
    );
    if (session.mode !== mode) {
      throw new Error('运行模式已在上传期间变化，请重新选择文件。');
    }
    const uploadUrl = session.upload.url.startsWith('/')
      ? `${apiUrl}${session.upload.url}`
      : session.upload.url;
    if (Platform.OS === 'web' && asset.file) {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: session.upload.headers,
        body: asset.file,
      });
      if (!response.ok) throw new Error(`音频上传失败（HTTP ${response.status}）。`);
    } else {
      const result = await new File(asset.uri).upload(uploadUrl, {
        headers: session.upload.headers,
        httpMethod: 'PUT',
        mimeType: asset.mimeType ?? 'application/octet-stream',
        sessionType: 'background',
        uploadType: UploadType.BINARY_CONTENT,
      });
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`音频上传失败（HTTP ${result.status}）。`);
      }
    }
    await request(
      `/api/audio-upload-sessions/${session.id}/complete`,
      AudioUploadSessionCompleteResponseSchema,
      { method: 'POST', timeoutMs: 120_000 },
    );
  }
}

export const archiveDataSourceAudioFile = (id: string, audioFileId: string) =>
  request(`/api/data-sources/${id}/audio-files/${audioFileId}`, null, { method: 'DELETE' });
