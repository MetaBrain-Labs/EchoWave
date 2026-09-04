/**
 * 一键式音频分析移动端 API 客户端。
 *
 * 封装批次创建、上传会话传输、查询、恢复和取消，并在所有响应边界执行共享契约校验。
 *
 * Responsibilities:
 * - 将 Document Picker 文件映射到批次上传项。
 * - 按 API 二进制或预签名 PUT 目标上传并完成校验。
 */
import {
  AudioAnalysisBatchCreateRequestSchema,
  AudioAnalysisBatchCreateResponseSchema,
  AudioAnalysisBatchListResponseSchema,
  AudioAnalysisBatchSchema,
  AudioAnalysisCancelResponseSchema,
  AudioAnalysisResumeResponseSchema,
  AudioUploadSessionCompleteResponseSchema,
  type AudioAnalysisBatchCreateRequest,
} from '@echowave/contracts';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';

import { apiUrl } from './apiUrl';
import { request } from './request';

export const listAudioAnalysisBatches = () =>
  request('/api/audio-analysis-batches', AudioAnalysisBatchListResponseSchema);
export const getAudioAnalysisBatch = (id: string) =>
  request(`/api/audio-analysis-batches/${id}`, AudioAnalysisBatchSchema);
export const resumeAudioAnalysisBatch = (id: string) =>
  request(`/api/audio-analysis-batches/${id}/resume`, AudioAnalysisResumeResponseSchema, {
    method: 'POST',
  });
export const resumeAudioAnalysisTask = (id: string) =>
  request(`/api/audio-analysis-tasks/${id}/resume`, AudioAnalysisResumeResponseSchema, {
    method: 'POST',
  });
export const cancelAudioAnalysisBatch = (id: string) =>
  request(`/api/audio-analysis-batches/${id}/cancel`, AudioAnalysisCancelResponseSchema, {
    method: 'POST',
  });
export const cancelAudioAnalysisTask = (id: string) =>
  request(`/api/audio-analysis-tasks/${id}/cancel`, AudioAnalysisCancelResponseSchema, {
    method: 'POST',
  });

/** 创建上传来源批次并逐个传输文件；批次详情始终可用于失败后的恢复观察。 */
export async function createUploadAnalysisBatch(
  input: Omit<AudioAnalysisBatchCreateRequest, 'source' | 'items'>,
  assets: DocumentPickerAsset[],
) {
  const indexed = assets.map((asset, index) => ({
    asset,
    clientItemId: `file-${index}-${asset.name}-${asset.size ?? asset.file?.size ?? 0}`,
  }));
  const created = await request(
    '/api/audio-analysis-batches',
    AudioAnalysisBatchCreateResponseSchema,
    {
      method: 'POST',
      body: AudioAnalysisBatchCreateRequestSchema.parse({
        ...input,
        source: 'uploads',
        items: indexed.map(({ asset, clientItemId }) => ({
          clientItemId,
          filename: asset.name,
          mimeType: asset.mimeType ?? 'application/octet-stream',
          sizeBytes: asset.size ?? asset.file?.size ?? new File(asset.uri).size,
        })),
      }),
    },
  );
  for (const target of created.uploads) {
    const asset = indexed.find((item) => item.clientItemId === target.clientItemId)!.asset;
    const uploadUrl = target.session.upload.url.startsWith('/')
      ? `${apiUrl}${target.session.upload.url}`
      : target.session.upload.url;
    if (Platform.OS === 'web' && asset.file) {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: target.session.upload.headers,
        body: asset.file,
      });
      if (!response.ok) throw new Error(`音频上传失败（HTTP ${response.status}）。`);
    } else {
      const result = await new File(asset.uri).upload(uploadUrl, {
        headers: target.session.upload.headers,
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
      `/api/audio-upload-sessions/${target.session.id}/complete`,
      AudioUploadSessionCompleteResponseSchema,
      { method: 'POST', timeoutMs: 120_000 },
    );
  }
  return getAudioAnalysisBatch(created.batch.id);
}

/** 创建已有音频批次，不重复上传或重跑可复用阶段。 */
export function createExistingAudioAnalysisBatch(input: AudioAnalysisBatchCreateRequest) {
  return request('/api/audio-analysis-batches', AudioAnalysisBatchCreateResponseSchema, {
    method: 'POST',
    body: AudioAnalysisBatchCreateRequestSchema.parse(input),
  });
}
