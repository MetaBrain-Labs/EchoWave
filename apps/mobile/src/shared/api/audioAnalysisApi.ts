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
  SpeakerReviewResolutionResponseSchema,
  AudioTranscriptConfirmationRequestSchema,
  AudioTranscriptConfirmationResponseSchema,
  AudioTranscriptionCapabilitiesResponseSchema,
  AudioTranscriptionStartRequestSchema,
  AudioTranscriptionStartResponseSchema,
  type AudioBusinessAnalysisStartRequest,
  type AudioTranscriptConfirmationRequest,
  type AudioTranscriptionStartRequest,
} from '@echowave/contracts';

import { request } from './request';

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
export const startAudioEmotionAnalysis = (id: string) =>
  request(`/api/audio-files/${id}/analysis/emotion`, AudioPostAnalysisStartResponseSchema, {
    method: 'POST',
  });
export const startAudioRoleRecognition = (id: string) =>
  request(`/api/audio-files/${id}/analysis/role`, AudioPostAnalysisStartResponseSchema, {
    method: 'POST',
  });
