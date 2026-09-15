/**
 * 本机录音提交恢复回归。
 *
 * 验证暂存不分析、轻量不请求网络及持久化后幂等重试。
 *
 * Responsibilities:
 * - 使用真实协调器覆盖上传失败、服务切换和冻结配置。
 *
 * Notes:
 * - 文件传输与 HTTP 作为外部边界替换。
 */
import { analyzeRecording, storeRecording } from '../recordingOperations';
import { request } from '@/shared/api/request';
import { getApiUrl } from '@/shared/api/apiUrl';
import { transferAudioSession } from '@/shared/api/audioUploadTransfer';
import { createUploadAnalysisBatch } from '@/shared/api/audioAutomationApi';
import type { RecordingDraft } from '@echowave/contracts';
jest.mock('@/shared/api/request', () => ({ request: jest.fn() }));
jest.mock('@/shared/api/apiUrl', () => ({ getApiUrl: jest.fn(() => 'https://example.com') }));
jest.mock('@/shared/api/audioRuntimeApi', () => ({ getAudioRuntime: jest.fn() }));
jest.mock('@/shared/api/audioUploadTransfer', () => ({ transferAudioSession: jest.fn() }));
jest.mock('@/shared/api/audioAutomationApi', () => ({ createUploadAnalysisBatch: jest.fn() }));
jest.mock('@/shared/api/audioAnalysisApi', () => ({ remountAudioSource: jest.fn() }));
jest.mock('../recordingStore', () => ({
  recordingAsset: () => ({
    uri: 'file:///documents/test.m4a',
    name: 'test.m4a',
    mimeType: 'audio/mp4',
    size: 1024,
  }),
}));
const draft: RecordingDraft = {
  version: 1,
  id: '11111111-1111-4111-8111-111111111111',
  title: 'test',
  createdAt: '2026-09-15T00:00:00.000Z',
  path: 'test.m4a',
  durationMs: 1000,
  sizeBytes: 1024,
  serverUrl: 'https://example.com',
  dataSourceId: '22222222-2222-4222-8222-222222222222',
  interrupted: false,
  state: 'local',
};
const session = {
  id: '33333333-3333-4333-8333-333333333333',
  audioFileId: '44444444-4444-4444-8444-444444444444',
  mode: 'hybrid' as const,
  status: 'created' as const,
  expiresAt: '2099-01-01T00:00:00.000Z',
  upload: { kind: 'api_binary' as const, url: '/content', headers: {} },
};
describe('recordingOperations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getApiUrl).mockReturnValue('https://example.com');
  });
  it('stores lightweight drafts without any network request', async () => {
    const save = jest.fn(async () => undefined);
    await storeRecording(draft, save, 'lightweight_local');
    expect(request).not.toHaveBeenCalled();
    expect(transferAudioSession).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ state: 'local' }));
  });
  it.each(['hybrid', 'object_storage'] as const)(
    'archives %s without creating an analysis batch',
    async (mode) => {
      (request as jest.Mock).mockResolvedValueOnce({}).mockResolvedValueOnce({ ...session, mode });
      jest
        .mocked(transferAudioSession)
        .mockResolvedValueOnce({ audioFileId: session.audioFileId, status: 'ready' });
      const saved = await storeRecording(
        draft,
        jest.fn(async () => undefined),
        mode,
      );
      expect(saved.audioFileId).toBe(session.audioFileId);
      expect(request).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.anything(),
        expect.objectContaining({
          body: expect.objectContaining({
            postUploadAction: 'store_only',
            idempotencyKey: `recording-store:${draft.id}`,
          }),
        }),
      );
      expect(createUploadAnalysisBatch).not.toHaveBeenCalled();
    },
  );
  it('retains session identity on failed transfer and reuses the same operation', async () => {
    let saved = draft;
    const save = async (value: RecordingDraft) => {
      saved = value;
    };
    (request as jest.Mock).mockResolvedValueOnce({}).mockResolvedValueOnce(session);
    jest.mocked(transferAudioSession).mockRejectedValueOnce(new Error('network failed'));
    await expect(storeRecording(draft, save, 'hybrid')).rejects.toThrow('network failed');
    expect(saved.session?.id).toBe(session.id);
    (request as jest.Mock)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ...session, status: 'ready' });
    jest
      .mocked(transferAudioSession)
      .mockResolvedValueOnce({ audioFileId: session.audioFileId, status: 'ready' });
    await storeRecording(saved, save, 'hybrid');
    expect(saved.operationKey).toBe(`recording-store:${draft.id}`);
    expect(saved.state).toBe('uploaded');
  });
  it('refuses a server switch before any transfer or submission', async () => {
    jest.mocked(getApiUrl).mockReturnValue('https://another.example.com');
    await expect(storeRecording(draft, jest.fn(), 'hybrid')).rejects.toThrow(
      'recording.serverChanged',
    );
    await expect(analyzeRecording(draft, 'group', 'en', 'full', jest.fn())).rejects.toThrow(
      'recording.serverChanged',
    );
    expect(request).not.toHaveBeenCalled();
  });
  it('reuses an uploaded asset and freezes transcription-only settings before submission', async () => {
    let saved: RecordingDraft | undefined;
    (request as jest.Mock).mockImplementationOnce(async () => {
      expect(saved?.batchRequest?.pipeline.confirmation).toBe('manual');
      return { batch: { id: session.id } };
    });
    await analyzeRecording(
      { ...draft, state: 'uploaded', audioFileId: session.audioFileId },
      'group',
      'en',
      'transcription_only',
      async (value) => {
        saved = value;
      },
    );
    expect(transferAudioSession).not.toHaveBeenCalled();
    expect(saved?.batchRequest).toEqual(
      expect.objectContaining({
        source: 'existing_audio',
        audioFileIds: [session.audioFileId],
        pipeline: expect.objectContaining({
          confirmation: 'manual',
          includeEmotion: false,
          includeRole: false,
          includeBusinessAnalysis: false,
        }),
      }),
    );
  });
});
