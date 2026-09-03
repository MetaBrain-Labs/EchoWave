/**
 * 音频运行模式 API 客户端。
 *
 * 封装公开模式概览和管理员保护的租户级配置更新。
 *
 * Responsibilities:
 * - 在客户端发送前解析共享请求契约。
 * - 对响应执行运行时校验。
 */
import {
  AudioRuntimeOverviewSchema,
  AudioRuntimeUpdateRequestSchema,
  type AudioRuntimeUpdateRequest,
} from '@echowave/contracts';

import { request } from './request';

export const getAudioRuntime = () => request('/api/audio-runtime', AudioRuntimeOverviewSchema);

export const updateAudioRuntime = (token: string, input: AudioRuntimeUpdateRequest) =>
  request('/api/settings/audio-runtime', AudioRuntimeOverviewSchema, {
    method: 'PUT',
    body: AudioRuntimeUpdateRequestSchema.parse(input),
    headers: { Authorization: `Bearer ${token}` },
  });
