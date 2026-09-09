/**
 * 音频处理与分析资源客户端。
 *
 * 封装转写、分析详情、执行轨迹和后分析命令。
 *
 * Responsibilities:
 * - 校验音频处理命令。
 * - 解析音频分析相关响应。
 *
 * Notes:
 * - 实时状态与执行事件由独立 SSE 客户端负责。
 */
import {
  AudioAiExecutionTraceResponseSchema,
  AudioAnalysisDetailSchema,
  AudioBusinessAnalysisStartRequestSchema,
  AudioBusinessAnalysisStartResponseSchema,
  AudioPostAnalysisStartResponseSchema,
  AudioPostAnalysisStartRequestSchema,
  SpeakerReviewResolutionResponseSchema,
  AudioTranscriptConfirmationRequestSchema,
  AudioTranscriptConfirmationResponseSchema,
  AudioTranscriptionCapabilitiesResponseSchema,
  AudioTranscriptionStartRequestSchema,
  AudioTranscriptionStartResponseSchema,
  AudioTranscriptionRunListResponseSchema,
  AudioTranscriptSelectionRequestSchema,
  AudioSourceRemountResponseSchema,
  type AudioBusinessAnalysisStartRequest,
  type AudioPostAnalysisStartRequest,
  type AudioTranscriptConfirmationRequest,
  type AudioTranscriptionStartRequest,
  type AudioTranscriptSelectionRequest,
} from '@echowave/contracts';

import { request } from './request';
import { getApiUrl } from './apiUrl';
import { localizeRequestError } from '@/shared/i18n/errorLocalization';
import { File, UploadType } from 'expo-file-system';
import type { DocumentPickerAsset } from 'expo-document-picker';

export const getAudioTranscriptionCapabilities = () =>
  request('/api/audio-transcription/capabilities', AudioTranscriptionCapabilitiesResponseSchema);
export const startAudioTranscription = (id: string, input: AudioTranscriptionStartRequest) =>
  request(`/api/audio-files/${id}/transcriptions`, AudioTranscriptionStartResponseSchema, {
    body: AudioTranscriptionStartRequestSchema.parse(input),
    method: 'POST',
  });
export const listAudioTranscriptions = (id: string) =>
  request(`/api/audio-files/${id}/transcriptions`, AudioTranscriptionRunListResponseSchema);
export const selectAudioTranscription = (id: string, input: AudioTranscriptSelectionRequest) =>
  request(`/api/audio-files/${id}/transcript-selection`, AudioTranscriptionRunListResponseSchema, {
    body: AudioTranscriptSelectionRequestSchema.parse(input),
    method: 'PUT',
  });
export const getAudioAnalysis = (id: string, groupId?: string) =>
  request(
    `/api/audio-files/${id}/analysis${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ''}`,
    AudioAnalysisDetailSchema,
  );
export const getAudioExecutionTrace = (id: string, groupId?: string) =>
  request(
    `/api/audio-files/${id}/analysis/executions${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ''}`,
    AudioAiExecutionTraceResponseSchema,
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
export const resolveSpeakerReviewFinding = (id: string, findingId: string) =>
  request(
    `/api/audio-files/${id}/speaker-review-findings/${findingId}`,
    SpeakerReviewResolutionResponseSchema,
    { method: 'DELETE' },
  );
export const resolveAllSpeakerReviewFindings = (id: string) =>
  request(`/api/audio-files/${id}/speaker-review-findings`, SpeakerReviewResolutionResponseSchema, {
    method: 'DELETE',
  });
export const startAudioEmotionAnalysis = (id: string, input: AudioPostAnalysisStartRequest) =>
  request(`/api/audio-files/${id}/analysis/emotion`, AudioPostAnalysisStartResponseSchema, {
    body: AudioPostAnalysisStartRequestSchema.parse(input),
    method: 'POST',
  });
export const startAudioRoleRecognition = (id: string, input: AudioPostAnalysisStartRequest) =>
  request(`/api/audio-files/${id}/analysis/role`, AudioPostAnalysisStartResponseSchema, {
    body: AudioPostAnalysisStartRequestSchema.parse(input),
    method: 'POST',
  });

/** 流式重新挂载轻量模式原文件，服务端会执行 SHA-256 一致性校验。 */
export async function remountAudioSource(id: string, asset: DocumentPickerAsset) {
  const url = `${getApiUrl()}/api/audio-files/${encodeURIComponent(id)}/source-remount`;
  if (asset.file) {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': asset.mimeType ?? 'application/octet-stream',
        'X-Audio-Filename': encodeURIComponent(asset.name),
      },
      body: asset.file,
    });
    if (!response.ok)
      throw new Error(
        localizeRequestError('HTTP_ERROR', `源文件重新挂载失败（HTTP ${response.status}）。`),
      );
    return AudioSourceRemountResponseSchema.parse(await response.json());
  }
  const result = await new File(asset.uri).upload(url, {
    headers: {
      'Content-Type': asset.mimeType ?? 'application/octet-stream',
      'X-Audio-Filename': encodeURIComponent(asset.name),
    },
    httpMethod: 'PUT',
    mimeType: asset.mimeType ?? 'application/octet-stream',
    sessionType: 'background',
    uploadType: UploadType.BINARY_CONTENT,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      localizeRequestError('HTTP_ERROR', `源文件重新挂载失败（HTTP ${result.status}）。`),
    );
  }
  const parsed = AudioSourceRemountResponseSchema.safeParse(JSON.parse(result.body));
  if (!parsed.success)
    throw new Error(localizeRequestError('INVALID_RESPONSE', '服务返回了无法识别的重新挂载结果。'));
  return parsed.data;
}
