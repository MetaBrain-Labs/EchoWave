/**
 * 单音频上传会话传输。
 *
 * 复用原生二进制流上传，绑定操作开始时的服务器并跳过已完成传输。
 *
 * Responsibilities:
 * - 区分上传完成与服务端任务接管。
 * - 让重试沿用既有会话，不重新复制音频到 JS 内存。
 *
 * Notes:
 * - 调用方必须先持久化会话引用。
 */
import {
  AudioUploadSessionCompleteResponseSchema,
  type AudioUploadSessionResponse,
} from '@echowave/contracts';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import { getApiUrl } from './apiUrl';
import { request } from './request';

/** 上传或补偿确认同一会话；切换服务器时停止后续请求。 */
export async function transferAudioSession(
  session: AudioUploadSessionResponse,
  asset: DocumentPickerAsset,
  serverUrl: string,
) {
  if (getApiUrl() !== serverUrl) throw new Error('recording.serverChanged');
  if (session.status !== 'ready' && new Date(session.expiresAt).getTime() <= Date.now())
    throw new Error('recording.sessionExpired');
  if (session.status === 'created') {
    const url = session.upload.url.startsWith('/')
      ? `${serverUrl}${session.upload.url}`
      : session.upload.url;
    if (Platform.OS === 'web' && asset.file) {
      const response = await fetch(url, {
        method: 'PUT',
        headers: session.upload.headers,
        body: asset.file,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } else {
      const result = await new File(asset.uri).upload(url, {
        headers: session.upload.headers,
        httpMethod: 'PUT',
        mimeType: asset.mimeType ?? 'application/octet-stream',
        sessionType: 'background',
        uploadType: UploadType.BINARY_CONTENT,
      });
      if (result.status < 200 || result.status >= 300) throw new Error(`HTTP ${result.status}`);
    }
  } else if (session.status === 'failed' || session.status === 'expired') {
    throw new Error('recording.sessionExpired');
  }
  return request(
    `/api/audio-upload-sessions/${session.id}/complete`,
    AudioUploadSessionCompleteResponseSchema,
    { method: 'POST', timeoutMs: 120_000, expectedServerUrl: serverUrl },
  );
}
