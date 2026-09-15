/**
 * 本机录音保存与任务提交协调。
 *
 * 用户选择暂存时按当前模式决定仅留本机或上传归档；分析复用已上传资产。
 *
 * Responsibilities:
 * - 在网络请求前保存幂等身份和请求快照。
 * - 校验服务器与数据源，并保留所有失败后的手机原件。
 *
 * Notes:
 * - 服务端分析结果仍由 PostgreSQL 拥有。
 */
import {
  AudioFileListResponseSchema,
  AudioAnalysisBatchCreateResponseSchema,
  AudioUploadSessionCreateRequestSchema,
  AudioUploadSessionResponseSchema,
  DataSourceDetailSchema,
} from '@echowave/contracts';
import { remountAudioSource } from '@/shared/api/audioAnalysisApi';
import { getApiUrl } from '@/shared/api/apiUrl';
import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';
import { createUploadAnalysisBatch } from '@/shared/api/audioAutomationApi';
import { transferAudioSession } from '@/shared/api/audioUploadTransfer';
import { request } from '@/shared/api/request';
import { recordingAsset, type RecordingDraft } from './recordingStore';
import {
  pipelineForPreference,
  type AnalysisPreference,
} from '@/shared/settings/AnalysisPreferenceProvider';

type Save = (draft: RecordingDraft) => Promise<void>;

/** 暂存轻量录音不发网络请求；持久模式上传完成后也不创建 ASR。 */
export async function storeRecording(
  draft: RecordingDraft,
  save: Save,
  knownMode?: 'hybrid' | 'object_storage' | 'lightweight_local',
) {
  if (!draft.dataSourceId || draft.serverUrl !== getApiUrl())
    throw new Error('recording.serverChanged');
  // 已完成上传的资产继续遵循创建时冻结的模式。
  if (draft.audioFileId && draft.state !== 'uploading') return draft;
  const runtime = knownMode ? { mode: knownMode } : await getAudioRuntime();
  if (draft.serverUrl !== getApiUrl()) throw new Error('recording.serverChanged');
  if (runtime.mode === 'lightweight_local' && !draft.session) {
    const local = { ...draft, state: 'local' as const };
    await save(local);
    return local;
  }
  const asset = recordingAsset(draft);
  await request(`/api/data-sources/${draft.dataSourceId}`, DataSourceDetailSchema, {
    expectedServerUrl: draft.serverUrl,
  });
  let current: RecordingDraft = {
    ...draft,
    state: 'uploading',
    operationKey: draft.operationKey ?? `recording-store:${draft.id}`,
  };
  await save(current);
  // 重复 create 返回更新后的会话状态和同一资产，不重复上传 ready 原件。
  const session = await request(
    `/api/data-sources/${draft.dataSourceId}/audio-upload-sessions`,
    AudioUploadSessionResponseSchema,
    {
      method: 'POST',
      expectedServerUrl: draft.serverUrl,
      body: AudioUploadSessionCreateRequestSchema.parse({
        filename: asset.name,
        mimeType: asset.mimeType,
        sizeBytes: asset.size,
        postUploadAction: 'store_only',
        idempotencyKey: current.operationKey,
      }),
    },
  );
  current = { ...current, session };
  await save(current);
  const completed = await transferAudioSession(session, asset, draft.serverUrl);
  current = { ...current, audioFileId: completed.audioFileId, state: 'uploaded' };
  await save(current);
  return current;
}

/** 保存请求快照再创建批次，恢复提交不会受后续偏好修改影响。 */
export async function analyzeRecording(
  draft: RecordingDraft,
  groupId: string,
  language: 'zh-CN' | 'en',
  preference: AnalysisPreference,
  save: Save,
) {
  if (!draft.dataSourceId || draft.serverUrl !== getApiUrl())
    throw new Error('recording.serverChanged');
  if (draft.state === 'submitted' && draft.batchId) return draft;
  if (!groupId) throw new Error('recording.selectGroup');
  if (draft.state === 'uploading') draft = await storeRecording(draft, save);
  const asset = recordingAsset(draft);
  if (draft.audioFileId && (draft.batchRequest?.pipeline.includeEmotion ?? preference === 'full')) {
    const files = await request(
      `/api/data-sources/${draft.dataSourceId}/audio-files`,
      AudioFileListResponseSchema,
      { expectedServerUrl: draft.serverUrl },
    );
    const remote = files.items.find((file) => file.id === draft.audioFileId);
    if (!remote) throw new Error('recording.fileUnavailable');
    if (remote.runtimeMode === 'lightweight_local' && remote.sourceState !== 'available') {
      if (getApiUrl() !== draft.serverUrl) throw new Error('recording.serverChanged');
      await remountAudioSource(draft.audioFileId, asset);
    }
  }
  const snapshot = draft.batchRequest ?? {
    dataSourceId: draft.dataSourceId,
    groupId,
    language,
    scheduledFor: null,
    pipeline: pipelineForPreference(preference),
    idempotencyKey: `recording-analysis:${draft.id}`,
    ...(draft.audioFileId
      ? { source: 'existing_audio' as const, audioFileIds: [draft.audioFileId] }
      : {
          source: 'uploads' as const,
          items: [
            {
              clientItemId: `file-0-${asset.name}-${asset.size}`.slice(0, 80),
              filename: asset.name,
              mimeType: asset.mimeType,
              sizeBytes: asset.size,
            },
          ],
        }),
  };
  let current: RecordingDraft = { ...draft, state: 'submitting', batchRequest: snapshot };
  await save(current);
  if (snapshot.source === 'uploads') {
    const input = {
      dataSourceId: snapshot.dataSourceId,
      groupId: snapshot.groupId,
      language: snapshot.language,
      scheduledFor: snapshot.scheduledFor,
      pipeline: snapshot.pipeline,
      idempotencyKey: snapshot.idempotencyKey,
    };
    const batch = await createUploadAnalysisBatch(input, [asset], {
      serverUrl: draft.serverUrl,
      onCreated: async (created) => {
        current = { ...current, batchId: created.batch.id, session: created.uploads[0]?.session };
        await save(current);
      },
    });
    current = {
      ...current,
      batchId: batch.id,
      audioFileId: current.session?.audioFileId,
      state: 'submitted',
    };
  } else {
    const created = await request(
      '/api/audio-analysis-batches',
      AudioAnalysisBatchCreateResponseSchema,
      { method: 'POST', body: snapshot, expectedServerUrl: draft.serverUrl },
    );
    current = { ...current, batchId: created.batch.id, state: 'submitted' };
  }
  await save(current);
  return current;
}
