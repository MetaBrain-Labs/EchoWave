/**
 * 自动分析批次详情页测试。
 *
 * 验证终态任务的报告入口和失败、取消阶段文案，避免把旧报告或“结束”状态暴露给用户。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import type { AudioAnalysisBatch } from '@echowave/contracts';

import { AnalysisBatchDetailScreen } from '../AnalysisBatchDetailScreen';
import * as automationApi from '@/shared/api/audioAutomationApi';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/shared/api/audioAutomationApi', () => ({
  cancelAudioAnalysisBatch: jest.fn(),
  cancelAudioAnalysisTask: jest.fn(),
  getAudioAnalysisBatch: jest.fn(),
  resumeAudioAnalysisBatch: jest.fn(),
  resumeAudioAnalysisTask: jest.fn(),
}));
jest.mock('@/shared/api/audioAnalysisApi', () => ({ remountAudioSource: jest.fn() }));
jest.mock('@/shared/api/liveUpdateStreams', () => ({
  streamAudioAnalysisBatch: jest.fn(async () => undefined),
}));

const taskId = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';
const dataSourceId = '33333333-3333-4333-8333-333333333333';
const groupId = '44444444-4444-4444-8444-444444444444';
const audioFileId = '55555555-5555-4555-8555-555555555555';

const configurationSnapshot = {
  groupName: '销售组',
  analysisTiming: 'automatic' as const,
  contentFocus: '分析销售表现',
  tone: '专业',
  customTags: [],
  knowledgeBaseIds: [],
  capabilityBindings: {
    transcription: null,
    staging: null,
    emotion: null,
    role: null,
    businessAnalysis: null,
    knowledgeEmbedding: null,
  },
  models: {
    transcription: null,
    emotion: null,
    role: null,
    businessAnalysis: null,
  },
};

function createBatch(task: Partial<AudioAnalysisBatch['tasks'][number]>): AudioAnalysisBatch {
  const item = {
    id: taskId,
    batchId,
    audioFileId,
    title: '客户访谈',
    runtimeMode: 'object_storage' as const,
    status: 'completed' as const,
    phase: 'done' as const,
    progress: 100,
    runAfter: null,
    warningCodes: [],
    blocker: null,
    error: null,
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    report: { audioFileId, groupId },
    reportAvailable: true,
    ...task,
  };
  return {
    id: batchId,
    dataSourceId,
    groupId,
    source: 'existing_audio',
    scheduledFor: null,
    configurationSnapshot,
    counts: {
      total: 1,
      active: 0,
      blocked: 0,
      completed: item.status === 'completed' ? 1 : 0,
      partial: item.status === 'completed_with_warnings' ? 1 : 0,
      failed: item.status === 'failed' ? 1 : 0,
      canceled: item.status === 'canceled' ? 1 : 0,
    },
    tasks: [item],
    createdAt: '2026-09-04T00:00:00.000Z',
  };
}

function renderBatch(batch: AudioAnalysisBatch) {
  jest.mocked(automationApi.getAudioAnalysisBatch).mockResolvedValue(batch);
  return render(
    <AnalysisBatchDetailScreen
      batchId={batchId}
      router={{ back: jest.fn(), replace: jest.fn() } as never}
    />,
  );
}

describe('AnalysisBatchDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the report only for a completed task', async () => {
    const screen = renderBatch(createBatch({ status: 'completed' }));

    expect(await screen.findByText('查看分析报告')).toBeTruthy();
    fireEvent.press(screen.getByText('查看分析报告'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/analysis/[id]',
      params: { id: audioFileId, groupId },
    });
  });

  it('shows warning as a separate terminal state while keeping the report entry', async () => {
    const screen = renderBatch(
      createBatch({
        status: 'completed_with_warnings',
        warningCodes: ['SPEAKER_REVIEW_REQUIRED'],
      }),
    );

    expect((await screen.findAllByText('警告')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('查看分析报告')).toBeTruthy();
  });

  it.each([
    ['failed', '失败于业务分析'],
    ['canceled', '已取消'],
  ] as const)('hides reports and labels %s tasks correctly', async (status, label) => {
    const screen = renderBatch(
      createBatch({
        status,
        phase: 'done',
        progress: 80,
        error:
          status === 'failed'
            ? { code: 'AUTOMATION_STAGE_FAILED', message: '失败', retryable: false }
            : null,
        reportAvailable: true,
      }),
    );

    expect((await screen.findAllByText(label)).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('查看分析报告')).toBeNull();
    await waitFor(() => expect(mockPush).not.toHaveBeenCalled());
  });
});
