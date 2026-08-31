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
import { Platform } from 'react-native';

import {
  AudioFileListResponseSchema,
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
} from '@echowave/contracts';

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

export const archiveDataSourceAudioFile = (id: string, audioFileId: string) =>
  request(`/api/data-sources/${id}/audio-files/${audioFileId}`, null, { method: 'DELETE' });
