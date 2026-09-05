/**
 * 分析详情页面测试。
 *
 * 验证分析内容、标签和展开交互在 presentation 数据下保持稳定。
 *
 * Responsibilities:
 * - 覆盖分析详情的主要用户交互。
 *
 * Notes:
 * - 不连接真实分析后端。
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import type { AudioAnalysisStatusStreamEvent } from '@echowave/contracts';
import { Alert, StyleSheet } from 'react-native';

import { fontFamilies, spacing, textColors } from '@/shared/theme/tokens';
import { AnalysisDetailScreen } from '../AnalysisDetailScreen';
import {
  setHideIrrelevantSegmentsPreference,
  setPostAnalysisControlsCollapsedPreference,
} from '../preferences';
import * as audioAnalysisApi from '@/shared/api/audioAnalysisApi';
import * as groupsApi from '@/shared/api/groupsApi';
import * as requestApi from '@/shared/api/request';
import * as executionStreamApi from '@/shared/api/audioExecutionStream';
import * as liveUpdateApi from '@/shared/api/liveUpdateStreams';
import { analysisFixture } from '@/test/workspaceFixtures';
import { mockAudioPlayers, resetExpoAudioMock } from '@/test/ExpoAudioMock';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/shared/api/audioAnalysisApi', () => {
  const actual = jest.requireActual('@/shared/api/audioAnalysisApi');
  return {
    ...actual,
    confirmAudioTranscript: jest.fn(),
    getAudioAnalysis: jest.fn(),
    getAudioExecutionTrace: jest.fn(),
    resolveAllSpeakerReviewFindings: jest.fn(),
    resolveSpeakerReviewFinding: jest.fn(),
    startAudioBusinessAnalysis: jest.fn(),
    startAudioEmotionAnalysis: jest.fn(),
    startAudioRoleRecognition: jest.fn(),
  };
});
jest.mock('@/shared/api/groupsApi', () => ({ getGroupSettings: jest.fn() }));

jest.mock('@/shared/api/audioExecutionStream', () => ({
  streamAudioExecutionTrace: jest.fn(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())),
  ),
}));
jest.mock('@/shared/api/liveUpdateStreams', () => ({
  streamAudioAnalysisStatus: jest.fn(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())),
  ),
}));

const workspaceApi = { ...audioAnalysisApi, ...groupsApi, ...requestApi };

async function renderAnalysis(
  detailId = analysisFixture.audioFileId,
  onBack = jest.fn(),
  groupId?: string,
  onOpenCitation?: (knowledgeBaseId: string, documentId: string, chunkId: string) => void,
) {
  const screen = render(
    <AnalysisDetailScreen
      detailId={detailId}
      groupId={groupId}
      onBack={onBack}
      onOpenCitation={onOpenCitation}
    />,
  );
  await waitFor(() => expect(screen.queryByLabelText('正在加载分析详情')).toBeNull());
  return screen;
}

function openAnalysisTasks(screen: Awaited<ReturnType<typeof renderAnalysis>>) {
  fireEvent.press(screen.getByRole('tab', { name: '分析任务' }));
}

describe('AnalysisDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetExpoAudioMock();
    setHideIrrelevantSegmentsPreference(false);
    setPostAnalysisControlsCollapsedPreference(true);
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValue(analysisFixture);
    jest.mocked(workspaceApi.getAudioExecutionTrace).mockResolvedValue({
      audioFileId: analysisFixture.audioFileId,
      analysisRevisionId: analysisFixture.id,
      runs: [],
    });
    jest.mocked(executionStreamApi.streamAudioExecutionTrace).mockClear();
    jest.mocked(liveUpdateApi.streamAudioAnalysisStatus).mockClear();
    jest.mocked(workspaceApi.getGroupSettings).mockResolvedValue({
      groupId: '10000000-0000-4000-8000-000000000001',
      name: '销售复盘组',
      analysis: {
        timing: 'automatic',
        contentFocus: '分析销售话术',
        tone: '正式、专业',
        customTags: [],
      },
      updatedAt: '2026-08-28T08:00:00.000Z',
    });
    jest.mocked(workspaceApi.startAudioBusinessAnalysis).mockResolvedValue({
      audioFileId: analysisFixture.audioFileId,
      groupId: '10000000-0000-4000-8000-000000000001',
      revisionId: analysisFixture.id,
      jobId: 'b1000000-0000-4000-8000-000000000001',
      status: 'queued',
      reused: false,
    });
    jest.mocked(workspaceApi.confirmAudioTranscript).mockResolvedValue({
      audioFileId: analysisFixture.audioFileId,
      analysisRevisionId: analysisFixture.id,
      confirmationId: 'a1000000-0000-4000-8000-000000000001',
      version: 2,
      confirmedAt: '2026-08-28T01:00:00.000Z',
    });
    jest.mocked(workspaceApi.resolveSpeakerReviewFinding).mockResolvedValue({
      audioFileId: analysisFixture.audioFileId,
      resolvedCount: 1,
    });
    jest.mocked(workspaceApi.resolveAllSpeakerReviewFindings).mockResolvedValue({
      audioFileId: analysisFixture.audioFileId,
      resolvedCount: 2,
    });
    jest.mocked(workspaceApi.startAudioEmotionAnalysis).mockResolvedValue({
      audioFileId: analysisFixture.audioFileId,
      revisionId: '50000000-0000-4000-8000-000000000001',
      jobId: '90000000-0000-4000-8000-000000000001',
      type: 'emotion',
      status: 'queued',
    });
    jest.mocked(workspaceApi.startAudioRoleRecognition).mockResolvedValue({
      audioFileId: analysisFixture.audioFileId,
      revisionId: '50000000-0000-4000-8000-000000000001',
      jobId: '90000000-0000-4000-8000-000000000002',
      type: 'role',
      status: 'queued',
    });
  });

  it('always shows role and emotion status before starting a group business analysis', async () => {
    const groupId = '10000000-0000-4000-8000-000000000001';
    const screen = await renderAnalysis(analysisFixture.audioFileId, jest.fn(), groupId);

    await waitFor(() => expect(screen.getByText('分析前检查')).toBeTruthy());
    expect(screen.getAllByText('未识别')).toHaveLength(2);
    fireEvent.press(screen.getByText('仍然分析'));

    await waitFor(() =>
      expect(workspaceApi.startAudioBusinessAnalysis).toHaveBeenCalledWith(
        analysisFixture.audioFileId,
        { groupId, force: false },
      ),
    );
  });

  it('confirms and starts the two post-analysis tasks independently', async () => {
    const screen = await renderAnalysis();
    openAnalysisTasks(screen);
    fireEvent.press(screen.getByRole('button', { name: '展开情绪分析与角色识别' }));

    fireEvent.press(screen.getByRole('button', { name: '情绪分析' }));
    expect(screen.getByText('开始情绪分析？')).toBeTruthy();
    expect(screen.getByText(/Qwen3.5-Omni-Flash/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '确认' }));
    await waitFor(() =>
      expect(workspaceApi.startAudioEmotionAnalysis).toHaveBeenCalledWith(
        analysisFixture.audioFileId,
      ),
    );

    fireEvent.press(screen.getByRole('button', { name: '角色识别' }));
    expect(screen.getByText('开始角色识别？')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '确认' }));
    await waitFor(() =>
      expect(workspaceApi.startAudioRoleRecognition).toHaveBeenCalledWith(
        analysisFixture.audioFileId,
      ),
    );
  });

  it('shows independent task progress and keeps a failed task retryable', async () => {
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValue({
      ...analysisFixture,
      postAnalysis: {
        emotion: {
          state: 'running',
          jobId: '90000000-0000-4000-8000-000000000001',
          model: 'qwen3.5-omni-flash',
          progress: 45,
          confirmationVersion: 1,
        },
        role: {
          state: 'failed',
          jobId: '90000000-0000-4000-8000-000000000002',
          model: 'deepseek-v4-flash',
          code: 'INVALID_MODEL_OUTPUT',
          message: '模型返回格式无效，请重试。',
          retryable: true,
          confirmationVersion: 1,
        },
      },
    });
    const screen = await renderAnalysis();
    await waitFor(() => expect(workspaceApi.getAudioAnalysis).toHaveBeenCalledTimes(2));
    openAnalysisTasks(screen);
    fireEvent.press(screen.getByRole('button', { name: '展开情绪分析与角色识别' }));

    expect(screen.getByText('分析中 45% · 基于确认版 v1')).toBeTruthy();
    expect(screen.getByText('模型返回格式无效，请重试。 · 基于确认版 v1')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新识别' })).toBeTruthy();
  });

  it('refreshes authoritative state immediately when SSE reports a terminal task', async () => {
    const jobId = '90000000-0000-4000-8000-000000000001';
    const running = {
      ...analysisFixture,
      postAnalysis: {
        emotion: {
          state: 'running' as const,
          jobId,
          model: 'qwen3.5-omni-flash',
          progress: 1,
          confirmationVersion: 1,
        },
        role: { state: 'idle' as const },
      },
    };
    const ready = {
      ...running,
      postAnalysis: {
        emotion: {
          state: 'ready' as const,
          jobId,
          model: 'qwen3.5-omni-flash',
          completedAt: '2026-08-29T01:00:03.000Z',
          confirmationVersion: 1,
        },
        role: { state: 'idle' as const },
      },
    };
    let emit: ((event: AudioAnalysisStatusStreamEvent) => void) | undefined;
    jest
      .mocked(liveUpdateApi.streamAudioAnalysisStatus)
      .mockImplementation(({ onEvent, signal }) => {
        emit = onEvent;
        return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      });
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValue(running);
    const screen = await renderAnalysis();
    await waitFor(() => expect(emit).toBeDefined());
    await waitFor(() => expect(workspaceApi.getAudioAnalysis).toHaveBeenCalledTimes(2));
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValue(ready);

    await act(async () => {
      emit?.({
        type: 'analysis-status',
        cursor: '2',
        occurredAt: '2026-08-29T01:00:03.000Z',
        audioFileId: analysisFixture.audioFileId,
        analysisRevisionId: analysisFixture.id,
        terminal: true,
        state: {
          emotion: ready.postAnalysis.emotion,
          role: ready.postAnalysis.role,
          business: {
            state: 'idle',
            groupId: null,
            jobId: null,
            model: null,
            progress: 0,
            confirmationVersion: null,
            settingsCurrent: true,
            knowledgeCurrent: true,
            error: null,
          },
        },
      });
    });

    openAnalysisTasks(screen);
    fireEvent.press(screen.getByRole('button', { name: '展开情绪分析与角色识别' }));
    await waitFor(() => expect(screen.getByText(/已完成/)).toBeTruthy());
  });

  it('requires confirmation before analysis and allows an unchanged first confirmation', async () => {
    const pendingFixture = {
      ...analysisFixture,
      transcriptConfirmation: {
        status: 'pending' as const,
        currentVersion: 0 as const,
        confirmedAt: null,
      },
      scenes: analysisFixture.scenes.map((scene) => ({
        ...scene,
        segments: scene.segments.map((segment) => ({ ...segment, confirmedText: null })),
      })),
    };
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce(pendingFixture);
    const screen = await renderAnalysis();

    openAnalysisTasks(screen);
    fireEvent.press(screen.getByRole('button', { name: '展开情绪分析与角色识别' }));
    expect(screen.getAllByText('请先确认转写正文')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '情绪分析' }).props.accessibilityState).toEqual({
      disabled: true,
    });

    fireEvent.press(screen.getByRole('button', { name: '编辑并确认' }));
    fireEvent.press(screen.getAllByRole('button', { name: '确认整份转写' })[0]);
    await waitFor(() => expect(workspaceApi.confirmAudioTranscript).toHaveBeenCalledTimes(1));
    expect(workspaceApi.confirmAudioTranscript).toHaveBeenCalledWith(
      analysisFixture.audioFileId,
      expect.objectContaining({
        analysisRevisionId: analysisFixture.id,
        baseVersion: 0,
        segments: expect.arrayContaining([
          expect.objectContaining({
            sourceSegmentId: analysisFixture.scenes[0].segments[0].id,
            parts: expect.arrayContaining([
              expect.objectContaining({ text: analysisFixture.scenes[0].segments[0].rawText }),
            ]),
          }),
        ]),
      }),
    );
  });

  it('switches between confirmed and raw text and submits all edited segments', async () => {
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      scenes: analysisFixture.scenes.map((scene, sceneIndex) => ({
        ...scene,
        segments: scene.segments.map((segment, segmentIndex) =>
          sceneIndex === 0 && segmentIndex === 0
            ? { ...segment, rawText: '阿里运服务', confirmedText: '阿里云服务' }
            : segment,
        ),
      })),
    });
    const screen = await renderAnalysis();
    expect(screen.getByText('阿里云服务')).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: '原始转写' }));
    expect(screen.getByText('阿里运服务')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: '继续修正' }));
    const input = screen.getByLabelText('host的转写正文');
    fireEvent.changeText(input, '阿里云计算服务');
    fireEvent.press(screen.getAllByRole('button', { name: '确认整份转写' })[0]);
    await waitFor(() => expect(workspaceApi.confirmAudioTranscript).toHaveBeenCalledTimes(1));
    expect(workspaceApi.confirmAudioTranscript).toHaveBeenCalledWith(
      analysisFixture.audioFileId,
      expect.objectContaining({
        baseVersion: 1,
        segments: expect.arrayContaining([
          expect.objectContaining({
            sourceSegmentId: analysisFixture.scenes[0].segments[0].id,
            parts: expect.arrayContaining([expect.objectContaining({ text: '阿里云计算服务' })]),
          }),
        ]),
      }),
    );
  });

  it('shows a speaker suspicion and confirms an exact two-part word split', async () => {
    const sourceSegmentId = '70000000-0000-4000-8000-000000000009';
    const finding = {
      id: '71000000-0000-4000-8000-000000000009',
      sourceSegmentId,
      splitAfterWordIndex: 0,
      kind: 'speaker_turn_suspected' as const,
      severity: 'high' as const,
      reasonCode: 'question_answer_transition' as const,
      explanation: '同一 Speaker 段内出现连续的提问与回答语义，建议回听边界。',
      source: 'rule' as const,
    };
    const segment = {
      ...analysisFixture.scenes[0].segments[0],
      id: sourceSegmentId,
      sourceSegmentId,
      speakerKey: 'Speaker 0',
      speakerLabel: 'Speaker 0',
      startMs: 0,
      endMs: 1_200,
      rawText: '这是怎么吃呀？这种打开就可以吃。',
      confirmedText: null,
      startWordIndex: 0,
      endWordIndex: 2,
      words: [
        { index: 0, startMs: 0, endMs: 500, text: '这是怎么吃呀', punctuation: '？' },
        { index: 1, startMs: 650, endMs: 1_200, text: '这种打开就可以吃', punctuation: '。' },
      ],
      reviewFindings: [finding],
    };
    const scene = { ...analysisFixture.scenes[0], segments: [segment] };
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      transcriptConfirmation: {
        status: 'pending',
        currentVersion: 0,
        confirmedAt: null,
      },
      speakerReview: {
        status: 'partial',
        model: null,
        message: '智能说话人复核未配置；当前仅显示本地规则结果。',
        resolvedAt: null,
        findings: [finding],
      },
      scenes: [scene],
      rawScenes: [scene],
    });
    const screen = await renderAnalysis();

    expect(screen.getByText('本录音仅识别到 1 位说话人。')).toBeTruthy();
    expect(screen.getByText('说话人待确认')).toBeTruthy();
    expect(screen.getByText(/智能说话人复核未完成/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '编辑并确认' }));
    fireEvent.press(screen.getByText('在此拆段'));
    fireEvent.press(screen.getAllByRole('button', { name: '确认整份转写' })[0]);

    await waitFor(() => expect(workspaceApi.confirmAudioTranscript).toHaveBeenCalledTimes(1));
    expect(workspaceApi.confirmAudioTranscript).toHaveBeenCalledWith(
      analysisFixture.audioFileId,
      expect.objectContaining({
        segments: [
          {
            sourceSegmentId,
            parts: [
              expect.objectContaining({
                speakerKey: 'Speaker 0',
                startWordIndex: 0,
                endWordIndex: 1,
              }),
              expect.objectContaining({
                speakerKey: 'Speaker 1',
                startWordIndex: 1,
                endWordIndex: 2,
              }),
            ],
          },
        ],
      }),
    );
  });

  it('hides, stacks, and resolves speaker review findings', async () => {
    const sourceSegmentId = analysisFixture.scenes[0].segments[0].id;
    const findings = [
      {
        id: '71000000-0000-4000-8000-000000000009',
        sourceSegmentId,
        splitAfterWordIndex: 0,
        kind: 'speaker_turn_suspected' as const,
        severity: 'high' as const,
        reasonCode: 'question_answer_transition' as const,
        explanation: '检测到问答切换。',
        source: 'rule' as const,
      },
      {
        id: '71000000-0000-4000-8000-000000000010',
        sourceSegmentId,
        splitAfterWordIndex: 1,
        kind: 'speaker_turn_suspected' as const,
        severity: 'medium' as const,
        reasonCode: 'long_internal_pause' as const,
        explanation: '检测到较长停顿。',
        source: 'model' as const,
      },
    ];
    const segment = { ...analysisFixture.scenes[0].segments[0], reviewFindings: findings };
    const scene = { ...analysisFixture.scenes[0], segments: [segment] };
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      speakerReview: {
        status: 'ready',
        model: 'deepseek-v4-flash',
        message: null,
        resolvedAt: null,
        findings,
      },
      scenes: [scene],
      rawScenes: [scene],
    });
    const screen = await renderAnalysis();

    expect(screen.getAllByText('说话人待确认')).toHaveLength(1);
    expect(screen.getByLabelText('还有 1 个说话人疑点')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('下一个说话人疑点'));
    expect(screen.getByText('检测到较长停顿。')).toBeTruthy();
    expect(screen.getByText('2 / 2')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('上一个说话人疑点'));
    expect(screen.getByText('检测到问答切换。')).toBeTruthy();
    fireEvent.press(screen.getByText('屏蔽说话人待确认'));
    expect(screen.queryByText('说话人待确认')).toBeNull();
    fireEvent.press(screen.getByText('屏蔽说话人待确认'));

    fireEvent.press(screen.getByText('确认无误'));
    await waitFor(() =>
      expect(workspaceApi.resolveSpeakerReviewFinding).toHaveBeenCalledWith(
        analysisFixture.audioFileId,
        findings[0].id,
      ),
    );
    expect(screen.getAllByText('说话人待确认')).toHaveLength(1);
    expect(screen.queryByLabelText('还有 1 个说话人疑点')).toBeNull();

    fireEvent.press(screen.getByText('全部审核通过'));
    await waitFor(() =>
      expect(workspaceApi.resolveAllSpeakerReviewFindings).toHaveBeenCalledWith(
        analysisFixture.audioFileId,
      ),
    );
    expect(screen.queryByText('说话人待确认')).toBeNull();
    expect(screen.queryByText('全部审核通过')).toBeNull();
    expect(screen.queryByText('屏蔽说话人待确认')).toBeNull();
    expect(screen.getByText('说话人复核已完成，所有疑点均已审核通过。')).toBeTruthy();
  });

  it('keeps a failed draft and warns before leaving with unconfirmed changes', async () => {
    jest.mocked(workspaceApi.confirmAudioTranscript).mockRejectedValueOnce(new Error('网络不可用'));
    const alert = jest.spyOn(Alert, 'alert');
    const onBack = jest.fn();
    const screen = await renderAnalysis(analysisFixture.audioFileId, onBack);
    fireEvent.press(screen.getByRole('button', { name: '继续修正' }));
    const input = screen.getByLabelText('host的转写正文');
    fireEvent.changeText(input, '仍需保留的草稿');
    fireEvent.press(screen.getAllByRole('button', { name: '确认整份转写' })[0]);
    await waitFor(() => expect(alert).toHaveBeenCalledWith('无法确认转写', '网络不可用'));
    expect(screen.getByDisplayValue('仍需保留的草稿')).toBeTruthy();

    alert.mockClear();
    fireEvent.press(screen.getByLabelText('返回'));
    expect(onBack).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      '放弃未确认的修改？',
      '返回后，本次修改不会被保存。',
      expect.any(Array),
    );
  });

  it('keeps the draft when the server rejects a stale confirmation version', async () => {
    jest
      .mocked(workspaceApi.confirmAudioTranscript)
      .mockRejectedValueOnce(
        new workspaceApi.WorkspaceRequestError('CONFLICT', '确认版本已变化，请重新加载后再编辑。'),
      );
    const alert = jest.spyOn(Alert, 'alert');
    const screen = await renderAnalysis();
    fireEvent.press(screen.getByRole('button', { name: '继续修正' }));
    fireEvent.changeText(screen.getByLabelText('host的转写正文'), '冲突时保留的草稿');
    fireEvent.press(screen.getAllByRole('button', { name: '确认整份转写' })[0]);

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        '确认版本已更新',
        '确认版本已变化，请重新加载后再编辑。',
        expect.any(Array),
      ),
    );
    expect(screen.getByDisplayValue('冲突时保留的草稿')).toBeTruthy();
  });

  it('defaults post-analysis controls to collapsed and remembers the latest session choice', async () => {
    const firstScreen = await renderAnalysis();
    openAnalysisTasks(firstScreen);

    expect(
      firstScreen.getByRole('button', { name: '展开情绪分析与角色识别' }).props.accessibilityState,
    ).toEqual(expect.objectContaining({ expanded: false }));
    expect(firstScreen.queryByRole('button', { name: '情绪分析' })).toBeNull();
    expect(firstScreen.queryByRole('button', { name: '角色识别' })).toBeNull();

    fireEvent.press(firstScreen.getByRole('button', { name: '展开情绪分析与角色识别' }));
    expect(firstScreen.getByRole('button', { name: '情绪分析' })).toBeTruthy();
    expect(firstScreen.getByRole('button', { name: '角色识别' })).toBeTruthy();
    firstScreen.unmount();

    const secondScreen = await renderAnalysis('40000000-0000-4000-8000-000000000002');
    openAnalysisTasks(secondScreen);
    expect(
      secondScreen.getByRole('button', { name: '折叠情绪分析与角色识别' }).props.accessibilityState,
    ).toEqual(expect.objectContaining({ expanded: true }));

    fireEvent.press(secondScreen.getByRole('button', { name: '折叠情绪分析与角色识别' }));
    secondScreen.unmount();

    const thirdScreen = await renderAnalysis('40000000-0000-4000-8000-000000000003');
    openAnalysisTasks(thirdScreen);
    expect(
      thirdScreen.getByRole('button', { name: '展开情绪分析与角色识别' }).props.accessibilityState,
    ).toEqual(expect.objectContaining({ expanded: false }));
  });

  it('opens the rich acoustic emotion details for a published segment', async () => {
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      scenes: [
        {
          ...analysisFixture.scenes[0],
          segments: [
            {
              ...analysisFixture.scenes[0].segments[0],
              emotion: 'anxious',
              emotionAnalysis: {
                label: 'anxious',
                confidence: 0.88,
                attitude: 'hesitant',
                arousal: 'high',
                pace: 'fast',
                volumeTrend: 'rising',
                pitchVariation: 'high',
                pausePattern: 'frequent',
                vocalCues: ['breathing becomes faster'],
                model: 'qwen3.5-omni-flash',
              },
            },
          ],
        },
      ],
    });
    const screen = await renderAnalysis();

    fireEvent.press(screen.getByText('焦虑'));
    expect(screen.getByText('情绪分析详情')).toBeTruthy();
    expect(screen.getByText('88%')).toBeTruthy();
    expect(screen.getByText(/breathing becomes faster/)).toBeTruthy();
  });

  it('adapts the detail page after lightweight source cleanup', async () => {
    const finding = {
      id: '71000000-0000-4000-8000-000000000010',
      sourceSegmentId: analysisFixture.scenes[0].segments[0].id,
      splitAfterWordIndex: 0,
      kind: 'speaker_turn_suspected' as const,
      severity: 'high' as const,
      reasonCode: 'question_answer_transition' as const,
      explanation: '请检查说话人边界。',
      source: 'rule' as const,
    };
    const segment = {
      ...analysisFixture.scenes[0].segments[0],
      reviewFindings: [finding],
      emotion: 'happy',
      emotionAnalysis: {
        label: 'happy' as const,
        confidence: 0.9,
        attitude: 'cooperative' as const,
        arousal: 'medium' as const,
        pace: 'normal' as const,
        volumeTrend: 'rising' as const,
        pitchVariation: 'medium' as const,
        pausePattern: 'few' as const,
        vocalCues: ['语气自然'],
        model: 'qwen3.5-omni-flash',
      },
    };
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      runtimeMode: 'lightweight_local',
      sourceState: 'cleaned',
      sourceRecoveryState: 'not_required',
      sourceDeleteAfter: '2026-09-03T04:00:00.000Z',
      transcriptConfirmation: {
        status: 'confirmed',
        currentVersion: 1,
        confirmedAt: '2026-09-03T03:00:00.000Z',
        origin: 'system_raw_snapshot',
      },
      speakerReview: {
        status: 'partial',
        model: null,
        message: '保留本地规则结果。',
        resolvedAt: null,
        findings: [finding],
      },
      postAnalysis: {
        emotion: {
          state: 'ready',
          jobId: '90000000-0000-4000-8000-000000000001',
          model: 'qwen3.5-omni-flash',
          completedAt: '2026-09-03T03:30:00.000Z',
          confirmationVersion: 1,
        },
        role: { state: 'idle' },
      },
      scenes: [{ ...analysisFixture.scenes[0], segments: [segment] }],
      rawScenes: [{ ...analysisFixture.scenes[0], segments: [segment] }],
    });
    const screen = await renderAnalysis();

    expect(screen.getByTestId('analysis-source-unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy();
    expect(screen.getByText('轻量本地模式：仅保留分析结果')).toBeTruthy();
    expect(screen.getByText('轻量本地已自动确认 v1')).toBeTruthy();
    expect(screen.queryByText('播放边界前后')).toBeNull();

    openAnalysisTasks(screen);
    fireEvent.press(screen.getByRole('button', { name: '展开情绪分析与角色识别' }));
    expect(screen.getByText(/已在转写时完成声学情绪分析/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重新分析' })).toBeNull();

    fireEvent.press(screen.getByText('愉快'));
    expect(screen.getByText('情绪分析详情')).toBeTruthy();
    expect(screen.getByText('90%')).toBeTruthy();
  });

  it('renders every invalid interval at its original timeline position and hides all on request', async () => {
    const firstSegment = {
      ...analysisFixture.scenes[0].segments[0],
      startMs: 35_000,
      endMs: 45_000,
    };
    const secondSegment = {
      ...analysisFixture.scenes[0].segments[1],
      startMs: 95_000,
      endMs: 105_000,
    };
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      invalidSegments: [
        {
          id: 'a0000000-0000-4000-8000-000000000001',
          startMs: 0,
          endMs: 35_000,
          reason: 'silero_vad_non_speech',
        },
        {
          id: 'a0000000-0000-4000-8000-000000000002',
          startMs: 45_000,
          endMs: 95_000,
          reason: 'silero_vad_non_speech',
        },
        {
          id: 'a0000000-0000-4000-8000-000000000003',
          startMs: 105_000,
          endMs: 130_000,
          reason: 'silero_vad_non_speech',
        },
      ],
      scenes: [
        {
          ...analysisFixture.scenes[0],
          segments: [firstSegment],
        },
        {
          ...analysisFixture.scenes[0],
          id: '60000000-0000-4000-8000-000000000002',
          index: 2,
          title: '第二场景',
          startMs: 95_000,
          segments: [secondSegment],
        },
      ],
    });
    const screen = await renderAnalysis();

    expect(screen.getByText('1. 开场与访谈背景')).toBeTruthy();
    expect(screen.getByText('已跳过 35 秒无效片段')).toBeTruthy();
    expect(screen.getByText('已跳过 50 秒无效片段')).toBeTruthy();
    expect(screen.getByText('已跳过 25 秒无效片段')).toBeTruthy();
    expect(screen.queryByText('已跳过 110 秒无效片段')).toBeNull();
    expect(
      screen.getAllByTestId(/^transcript-timeline-item-/).map((item) => item.props.testID),
    ).toEqual([
      'transcript-timeline-item-invalid-a0000000-0000-4000-8000-000000000001',
      `transcript-timeline-item-segment-${firstSegment.id}`,
      'transcript-timeline-item-invalid-a0000000-0000-4000-8000-000000000002',
      `transcript-timeline-item-segment-${secondSegment.id}`,
      'transcript-timeline-item-invalid-a0000000-0000-4000-8000-000000000003',
    ]);
    expect(StyleSheet.flatten(screen.getByText('转写分析').props.style)).toEqual(
      expect.objectContaining({ paddingBottom: 4 }),
    );

    fireEvent.press(screen.getByText('跳过无效音频'));

    expect(screen.queryByText('已跳过 35 秒无效片段')).toBeNull();
    expect(screen.queryByText('已跳过 50 秒无效片段')).toBeNull();
    expect(screen.queryByText('已跳过 25 秒无效片段')).toBeNull();
  });

  it('does not render an invalid-audio marker when no interval was skipped', async () => {
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      invalidSegments: [],
    });
    const screen = await renderAnalysis();

    expect(screen.queryAllByTestId(/^transcript-timeline-item-invalid-/)).toHaveLength(0);
  });

  it('promotes the recognized role and labels its confidence', async () => {
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      summarySections: [],
      scenes: [
        {
          ...analysisFixture.scenes[0],
          segments: [
            {
              ...analysisFixture.scenes[0].segments[0],
              speakerKey: 'Speaker 0',
              speakerLabel: '销售',
              businessRole: '销售',
              emotion: 'neutral',
              roleAnalysis: {
                kind: 'sales',
                label: '销售',
                confidence: 0.92,
                evidenceSegmentIds: [],
                model: 'deepseek-v4-flash',
              },
            },
          ],
        },
      ],
    });
    const screen = await renderAnalysis();

    expect(screen.getByText('销售')).toBeTruthy();
    expect(screen.getByText('Speaker 0 · 角色置信度 92%')).toBeTruthy();
    expect(screen.queryByText('Speaker 0')).toBeNull();
    expect(screen.getByText('平静')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '分析总结' })).toBeNull();
    const detailTabs = screen.getAllByRole('tab').slice(0, 3);
    ['转写分析', '分析任务', '模型详情'].forEach((label, index) => {
      expect(within(detailTabs[index]).getByText(label)).toBeTruthy();
    });
  });

  it('orders the four detail tabs and keeps task controls out of the transcript page', async () => {
    jest.mocked(workspaceApi.getGroupSettings).mockResolvedValueOnce({
      groupId: '10000000-0000-4000-8000-000000000001',
      name: '销售复盘组',
      analysis: {
        timing: 'manual',
        contentFocus: '分析销售话术',
        tone: '正式、专业',
        customTags: [],
      },
      updatedAt: '2026-08-28T08:00:00.000Z',
    });
    const screen = await renderAnalysis(
      analysisFixture.audioFileId,
      jest.fn(),
      '10000000-0000-4000-8000-000000000001',
    );

    const detailTabs = screen.getAllByRole('tab').slice(0, 4);
    ['转写分析', '分析任务', '分析总结', '模型详情'].forEach((label, index) => {
      expect(within(detailTabs[index]).getByText(label)).toBeTruthy();
    });
    expect(
      within(screen.getByTestId('analysis-transcript-page')).queryByRole('button', {
        name: '展开情绪分析与角色识别',
      }),
    ).toBeNull();

    openAnalysisTasks(screen);
    expect(screen.getByRole('button', { name: '展开情绪分析与角色识别' })).toBeTruthy();
    expect(screen.getByText('ASR 结果分析')).toBeTruthy();
  });

  it('explains when the selected model did not return speaker information', async () => {
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      transcription: {
        ...analysisFixture.transcription,
        diarizationStatus: 'not_returned',
        responseGranularity: 'chunk',
        speakerIdentityScope: 'none',
      },
    });

    const screen = await renderAnalysis();

    expect(screen.getByText('本次模型未返回说话人信息，以下使用匿名发言编号。')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('uses anonymous utterance labels for chunk-scoped speaker identities', async () => {
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      transcription: {
        ...analysisFixture.transcription,
        speakerIdentityScope: 'chunk',
      },
    });

    const screen = await renderAnalysis();

    expect(screen.getByText('发言 1')).toBeTruthy();
    expect(screen.getByText(/只保证分块内的说话人身份/)).toBeTruthy();
  });

  it('does not show a speaker warning when diarization was observed', async () => {
    const screen = await renderAnalysis();

    expect(screen.queryByText(/本次模型未返回说话人信息/)).toBeNull();
  });

  it('uses the approved display title and Kai transcript semantics', async () => {
    const screen = await renderAnalysis();
    const transcript = screen.getByText(
      '今天想和你聊聊最近使用团队音频整理工具的体验。先从日常工作开始，你通常会在什么场景下记录和回听访谈？',
    );

    expect(StyleSheet.flatten(transcript.props.style)).toEqual(
      expect.objectContaining({
        color: textColors.primary,
        fontFamily: fontFamilies.kai,
      }),
    );

    fireEvent.press(screen.getByText('分析总结'));
    const title = screen.getByText('产品访谈分析');

    expect(StyleSheet.flatten(title.props.style)).toEqual(
      expect.objectContaining({
        fontFamily: fontFamilies.sansBold,
        fontSize: 32,
        fontWeight: 'bold',
        lineHeight: 48,
      }),
    );
  });

  it('operates the real player controls and collapses the expanded UI on summary', async () => {
    const screen = await renderAnalysis();
    const player = mockAudioPlayers.at(-1)!;

    fireEvent.press(screen.getByLabelText('展开播放器'));
    expect(screen.getByLabelText('收起播放器')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('前进 15 秒'));
    await waitFor(() => expect(player.seekTo).toHaveBeenLastCalledWith(15));
    expect(screen.getByText('00:15')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('后退 15 秒'));
    await waitFor(() => expect(player.seekTo).toHaveBeenLastCalledWith(0));

    fireEvent.press(screen.getByLabelText('当前倍速 1.0 倍，点击切换'));
    expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5, 'medium');
    expect(screen.getByText('x1.5')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('播放音频'));
    expect(player.play).toHaveBeenCalled();
    expect(screen.getByLabelText('暂停音频')).toBeTruthy();

    fireEvent.press(screen.getByText('分析总结'));
    expect(screen.queryByLabelText('收起播放器')).toBeNull();
    expect(screen.getByText('产品访谈分析')).toBeTruthy();
  });

  it('plays one transcript segment and pauses automatically at its end', async () => {
    const screen = await renderAnalysis();
    const player = mockAudioPlayers.at(-1)!;
    const segment = analysisFixture.scenes[0].segments[0];
    const playButton = screen.getAllByLabelText(/^播放片段/)[0];

    fireEvent.press(playButton);
    await waitFor(() => expect(player.seekTo).toHaveBeenCalledWith(segment.startMs / 1_000));
    expect(player.play).toHaveBeenCalled();
    expect(screen.getAllByLabelText(/^暂停片段/)[0]).toBeTruthy();

    act(() => {
      player.update({ currentTime: segment.endMs / 1_000, playing: true });
    });
    await waitFor(() => expect(player.pause).toHaveBeenCalled());
    expect(screen.getAllByLabelText(/^播放片段/)[0]).toBeTruthy();
  });

  it('keeps segment playback available while editing confirmed text', async () => {
    const screen = await renderAnalysis();
    const player = mockAudioPlayers.at(-1)!;

    fireEvent.press(screen.getByText('继续修正'));
    fireEvent.press(screen.getAllByLabelText(/^播放片段/)[0]);

    await waitFor(() => expect(player.play).toHaveBeenCalled());
    expect(screen.getAllByLabelText(/的转写正文/).length).toBeGreaterThan(0);
  });

  it('switches analysis pages with a horizontal swipe', async () => {
    const screen = await renderAnalysis();

    fireEvent.press(screen.getByLabelText('展开播放器'));
    fireEvent(screen.getByTestId('analysis-tab-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 480, y: 0 } },
    });

    expect(screen.getByRole('tab', { name: '分析任务' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.queryByLabelText('收起播放器')).toBeNull();
  });

  it('opens and closes the selected AI tag sheet', async () => {
    const screen = await renderAnalysis();

    fireEvent.press(screen.getByLabelText('查看 AI 标签：高频访谈记录场景'));

    expect(screen.getAllByText('高频访谈记录场景')).toHaveLength(2);
    expect(screen.getByText('隐藏无关片段')).toBeTruthy();

    fireEvent.press(screen.getByText('隐藏无关片段'));
    fireEvent.press(screen.getByLabelText('收起 AI 标签面板'));

    expect(screen.queryByTestId('ai-tag-sheet')).toBeNull();
    expect(screen.getAllByText('高频访谈记录场景')).toHaveLength(1);
  });

  it('shows citation excerpts and forwards the complete knowledge location', async () => {
    const onOpenCitation = jest.fn();
    const knowledgeBaseId = 'a1000000-0000-4000-8000-000000000010';
    const documentId = 'a1000000-0000-4000-8000-000000000011';
    const chunkId = 'a1000000-0000-4000-8000-000000000012';
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      businessAnalysis: {
        state: 'ready',
        groupId: '10000000-0000-4000-8000-000000000001',
        jobId: 'a1000000-0000-4000-8000-000000000013',
        model: 'deepseek-v4-flash',
        progress: 100,
        confirmationVersion: 1,
        settingsCurrent: true,
        knowledgeCurrent: true,
        error: null,
        result: {
          jobId: 'a1000000-0000-4000-8000-000000000013',
          groupId: '10000000-0000-4000-8000-000000000001',
          confirmationVersion: 1,
          model: 'deepseek-v4-flash',
          generatedAt: '2026-08-29T01:00:00.000Z',
          knowledgeBaseIds: [knowledgeBaseId],
          knowledgeStatus: 'used',
          limitations: [],
          summarySections: [],
          tags: [
            {
              id: 'a1000000-0000-4000-8000-000000000014',
              category: 'strength',
              customLabel: null,
              title: '知识证据标签',
              summary: '结论有具体知识依据。',
              details: [],
              confidence: 90,
              evidenceSegmentIds: [analysisFixture.scenes[0].segments[0].id],
              citations: [
                {
                  chunkId,
                  knowledgeBaseId,
                  documentId,
                  documentTitle: '销售异议处理手册',
                  excerpt: '先确认客户顾虑，再使用可核实的案例说明方案价值。',
                  locator: {
                    kind: 'markdown',
                    headingPath: ['异议处理'],
                    lineStart: 12,
                    lineEnd: 18,
                  },
                },
              ],
            },
          ],
        },
      },
    });
    const screen = await renderAnalysis(
      analysisFixture.audioFileId,
      jest.fn(),
      undefined,
      onOpenCitation,
    );

    fireEvent.press(screen.getByLabelText('查看 AI 标签：知识证据标签'));
    expect(screen.getByText('先确认客户顾虑，再使用可核实的案例说明方案价值。')).toBeTruthy();
    fireEvent.press(screen.getByRole('link', { name: '查看知识依据：销售异议处理手册' }));
    expect(onOpenCitation).toHaveBeenCalledWith(knowledgeBaseId, documentId, chunkId);
  });

  it('embeds the AI tag control in its transcript timeline rail', async () => {
    const screen = await renderAnalysis();
    const segmentId = analysisFixture.scenes[0].segments[0].id;
    const rail = screen.getByTestId(`timeline-rail-${segmentId}`);

    expect(StyleSheet.flatten(rail.props.style)).toEqual(
      expect.objectContaining({ gap: spacing.sm }),
    );
    const marker = within(rail).getByLabelText('查看 AI 标签：高频访谈记录场景');
    expect(StyleSheet.flatten(marker.props.style)).toEqual(
      expect.objectContaining({ width: '100%' }),
    );
    expect(StyleSheet.flatten(within(marker).getByText('高频访谈记录场景').props.style)).toEqual(
      expect.objectContaining({ flex: 1, minWidth: 0, textAlign: 'right' }),
    );
    expect(
      screen.getByTestId(
        `ai-tag-timeline-marker-${segmentId}-${analysisFixture.scenes[0].segments[0].aiTag?.id}`,
      ),
    ).toBeTruthy();
  });

  it('dims unrelated paragraphs and hides them on request', async () => {
    const screen = await renderAnalysis();
    const selectedText =
      '今天想和你聊聊最近使用团队音频整理工具的体验。先从日常工作开始，你通常会在什么场景下记录和回听访谈？';
    const unrelatedText =
      '最常见的是用户访谈和每周复盘。我会先完整录音，结束后再回听并整理重点，但在很长的录音里寻找关键内容会花不少时间。';

    fireEvent.press(screen.getByLabelText('查看 AI 标签：高频访谈记录场景'));

    expect(StyleSheet.flatten(screen.getByText(selectedText).props.style)).toEqual(
      expect.objectContaining({ color: textColors.primary }),
    );
    expect(StyleSheet.flatten(screen.getByText(unrelatedText).props.style)).toEqual(
      expect.objectContaining({ color: textColors.tertiary }),
    );

    fireEvent.press(screen.getByText('隐藏无关片段'));

    expect(screen.getByText(selectedText)).toBeTruthy();
    expect(screen.queryByText(unrelatedText)).toBeNull();
    expect(screen.queryAllByTestId(/^transcript-timeline-item-invalid-/)).toHaveLength(0);
  });

  it('keeps the hide preference across analysis records in the app session', async () => {
    const firstScreen = await renderAnalysis();

    fireEvent.press(firstScreen.getByLabelText('查看 AI 标签：高频访谈记录场景'));
    fireEvent.press(firstScreen.getByText('隐藏无关片段'));
    firstScreen.unmount();

    const secondScreen = await renderAnalysis('40000000-0000-4000-8000-000000000002');
    fireEvent.press(secondScreen.getByLabelText('查看 AI 标签：高频访谈记录场景'));

    expect(
      secondScreen.getByRole('checkbox', { name: '隐藏无关片段' }).props.accessibilityState,
    ).toEqual({ checked: true });
  });

  it('keeps the fixed preference row outside the independently scrollable panel', async () => {
    const screen = await renderAnalysis();

    fireEvent.press(screen.getByLabelText('查看 AI 标签：高频访谈记录场景'));

    expect(
      within(screen.getByTestId('ai-tag-fixed-header')).getByText('隐藏无关片段'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('ai-tag-scroll-content')).queryByText('隐藏无关片段'),
    ).toBeNull();
  });

  it('limits the analysis panel according to the audio player state', async () => {
    const screen = await renderAnalysis();
    const openTag = () => fireEvent.press(screen.getByLabelText('查看 AI 标签：高频访谈记录场景'));

    openTag();
    expect(StyleSheet.flatten(screen.getByTestId('ai-tag-sheet').props.style)).toEqual(
      expect.objectContaining({ maxHeight: '50%' }),
    );

    fireEvent.press(screen.getByLabelText('收起 AI 标签面板'));
    fireEvent.press(screen.getByLabelText('展开播放器'));
    openTag();

    expect(StyleSheet.flatten(screen.getByTestId('ai-tag-sheet').props.style)).toEqual(
      expect.objectContaining({ maxHeight: '33%' }),
    );
  });

  it('lazy-loads safe model, tool and knowledge retrieval details', async () => {
    const groupId = '10000000-0000-4000-8000-000000000001';
    jest.mocked(workspaceApi.getAudioExecutionTrace).mockResolvedValueOnce({
      audioFileId: analysisFixture.audioFileId,
      analysisRevisionId: analysisFixture.id,
      runs: [
        {
          id: 'e1000000-0000-4000-8000-000000000001',
          kind: 'audio-business-analysis',
          name: 'EchoWave sales conversation review',
          phase: null,
          status: 'completed',
          groupId,
          sourceJobId: 'b1000000-0000-4000-8000-000000000001',
          startedAt: '2026-08-29T01:00:00.000Z',
          completedAt: '2026-08-29T01:00:02.000Z',
          durationMs: 2_000,
          error: null,
          steps: [
            {
              id: 'f1000000-0000-4000-8000-000000000001',
              sequence: 1,
              name: 'retrieval-planning',
              status: 'completed',
              occurredAt: '2026-08-29T01:00:00.500Z',
              durationMs: 120,
              summary: { queryCount: 1 },
            },
          ],
          modelCalls: [
            {
              id: 'f2000000-0000-4000-8000-000000000002',
              sequence: 2,
              operation: 'business-analysis-generation',
              name: '结合转写与知识证据生成业务分析',
              provider: 'deepseek',
              model: 'deepseek-v4-flash',
              status: 'completed',
              attempt: 1,
              startedAt: '2026-08-29T01:00:01.000Z',
              completedAt: '2026-08-29T01:00:01.800Z',
              durationMs: 800,
              inputTokens: 1200,
              outputTokens: 300,
              reasoningMode: 'streaming',
              reasoningContent: '先核对客户异议，再结合知识证据。',
              reasoningTruncated: false,
              estimatedCost: null,
            },
          ],
          toolCalls: [
            {
              id: 'f3000000-0000-4000-8000-000000000003',
              sequence: 3,
              operation: 'search_knowledge',
              name: '检索分组关联知识库',
              status: 'completed',
              startedAt: '2026-08-29T01:00:01.500Z',
              completedAt: '2026-08-29T01:00:01.560Z',
              durationMs: 60,
              query: '客户价格异议处理',
              knowledgeBases: [{ id: 'b0000000-0000-4000-8000-000000000001', name: '销售知识库' }],
              hitCount: 1,
              hits: [
                {
                  chunkId: 'c0000000-0000-4000-8000-000000000001',
                  knowledgeBaseId: 'b0000000-0000-4000-8000-000000000001',
                  documentId: 'd0000000-0000-4000-8000-000000000001',
                  documentTitle: '销售异议处理手册',
                  locator: {
                    kind: 'markdown',
                    headingPath: ['价格异议'],
                    lineStart: 10,
                    lineEnd: 18,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const screen = await renderAnalysis(analysisFixture.audioFileId, jest.fn(), groupId);

    expect(workspaceApi.getAudioExecutionTrace).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('tab', { name: '模型详情' }));

    await waitFor(() =>
      expect(workspaceApi.getAudioExecutionTrace).toHaveBeenCalledWith(
        analysisFixture.audioFileId,
        groupId,
      ),
    );
    expect(screen.getByText(/原始推理属于模型未验证的中间过程/)).toBeTruthy();
    fireEvent.press(await screen.findByText('业务分析'));
    expect(screen.getByText('结合转写与知识证据生成业务分析')).toBeTruthy();
    expect(await screen.findByText('deepseek · deepseek-v4-flash')).toBeTruthy();
    expect(screen.getByText('查询：客户价格异议处理')).toBeTruthy();
    expect(screen.getByText('知识库：销售知识库')).toBeTruthy();
    expect(screen.getByText('销售异议处理手册')).toBeTruthy();
  });

  it('adds a running named model call and appends reasoning in place from SSE', async () => {
    const groupId = '10000000-0000-4000-8000-000000000001';
    const runId = 'e1000000-0000-4000-8000-000000000001';
    const operationId = 'f2000000-0000-4000-8000-000000000002';
    let streamOptions:
      Parameters<typeof executionStreamApi.streamAudioExecutionTrace>[0] | undefined;
    jest.mocked(executionStreamApi.streamAudioExecutionTrace).mockImplementationOnce((options) => {
      streamOptions = options;
      return new Promise<void>((resolve) =>
        options.signal.addEventListener('abort', () => resolve()),
      );
    });
    const screen = await renderAnalysis(analysisFixture.audioFileId, jest.fn(), groupId);
    fireEvent.press(screen.getByRole('tab', { name: '模型详情' }));
    await waitFor(() => expect(streamOptions).toBeDefined());
    await waitFor(() => expect(workspaceApi.getAudioExecutionTrace).toHaveBeenCalledTimes(1));

    const runningCall = {
      id: operationId,
      sequence: 2,
      operation: 'business-analysis-generation',
      name: '结合转写与知识证据生成业务分析',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      status: 'running' as const,
      attempt: 1,
      startedAt: '2026-08-29T01:00:01.000Z',
      completedAt: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      reasoningMode: 'streaming' as const,
      reasoningContent: '',
      reasoningTruncated: false,
      estimatedCost: null,
    };
    await act(async () => {
      streamOptions?.onEvent({
        type: 'snapshot',
        cursor: '1',
        audioFileId: analysisFixture.audioFileId,
        analysisRevisionId: analysisFixture.id,
        trace: {
          audioFileId: analysisFixture.audioFileId,
          analysisRevisionId: analysisFixture.id,
          runs: [
            {
              id: runId,
              kind: 'audio-business-analysis',
              name: 'EchoWave sales conversation review',
              phase: null,
              status: 'running',
              groupId,
              sourceJobId: 'b1000000-0000-4000-8000-000000000001',
              startedAt: '2026-08-29T01:00:00.000Z',
              completedAt: null,
              durationMs: null,
              error: null,
              steps: [],
              modelCalls: [],
              toolCalls: [],
            },
          ],
        },
      });
      streamOptions?.onEvent({
        type: 'model-start',
        cursor: '2',
        audioFileId: analysisFixture.audioFileId,
        analysisRevisionId: analysisFixture.id,
        runId,
        operationId,
        modelCall: runningCall,
      });
      streamOptions?.onEvent({
        type: 'reasoning-delta',
        cursor: '3',
        audioFileId: analysisFixture.audioFileId,
        analysisRevisionId: analysisFixture.id,
        runId,
        operationId,
        delta: '先核对转写，再检查知识证据。',
        truncated: false,
      });
    });

    fireEvent.press(await screen.findByText(runningCall.name));
    expect(screen.getByText(`当前关注事项：${runningCall.name}`)).toBeTruthy();
    fireEvent.press(screen.getByText('原始推理'));
    expect(screen.getByText('先核对转写，再检查知识证据。')).toBeTruthy();
    const reasoningScroll = screen.getByTestId(`reasoning-scroll-${operationId}`);
    expect(reasoningScroll).toHaveStyle({ maxHeight: 240 });
    fireEvent(reasoningScroll, 'scrollBeginDrag');
    fireEvent.scroll(reasoningScroll, {
      nativeEvent: {
        contentOffset: { x: 0, y: 120 },
        contentSize: { height: 800, width: 320 },
        layoutMeasurement: { height: 240, width: 320 },
      },
    });
    fireEvent(reasoningScroll, 'scrollEndDrag', {
      nativeEvent: {
        contentOffset: { x: 0, y: 120 },
        contentSize: { height: 800, width: 320 },
        layoutMeasurement: { height: 240, width: 320 },
      },
    });
    expect(screen.getByRole('button', { name: '回到最新' })).toBeTruthy();

    await act(async () => {
      streamOptions?.onEvent({
        type: 'reasoning-delta',
        cursor: '4',
        audioFileId: analysisFixture.audioFileId,
        analysisRevisionId: analysisFixture.id,
        runId,
        operationId,
        delta: '继续检查成交风险。',
        truncated: false,
      });
    });
    expect(screen.getByText('先核对转写，再检查知识证据。继续检查成交风险。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '回到最新' })).toBeTruthy();

    fireEvent(reasoningScroll, 'scrollBeginDrag');
    fireEvent.scroll(reasoningScroll, {
      nativeEvent: {
        contentOffset: { x: 0, y: 560 },
        contentSize: { height: 800, width: 320 },
        layoutMeasurement: { height: 240, width: 320 },
      },
    });
    fireEvent(reasoningScroll, 'scrollEndDrag', {
      nativeEvent: {
        contentOffset: { x: 0, y: 560 },
        contentSize: { height: 800, width: 320 },
        layoutMeasurement: { height: 240, width: 320 },
      },
    });
    expect(screen.queryByRole('button', { name: '回到最新' })).toBeNull();

    fireEvent(reasoningScroll, 'scrollBeginDrag');
    fireEvent(reasoningScroll, 'scrollEndDrag', {
      nativeEvent: {
        contentOffset: { x: 0, y: 100 },
        contentSize: { height: 800, width: 320 },
        layoutMeasurement: { height: 240, width: 320 },
      },
    });
    fireEvent.press(screen.getByRole('button', { name: '回到最新' }));
    expect(screen.queryByRole('button', { name: '回到最新' })).toBeNull();

    jest.mocked(workspaceApi.getAudioExecutionTrace).mockResolvedValueOnce({
      audioFileId: analysisFixture.audioFileId,
      analysisRevisionId: analysisFixture.id,
      runs: [
        {
          id: runId,
          kind: 'audio-business-analysis',
          name: 'EchoWave sales conversation review',
          phase: null,
          status: 'completed',
          groupId,
          sourceJobId: 'b1000000-0000-4000-8000-000000000001',
          startedAt: '2026-08-29T01:00:00.000Z',
          completedAt: '2026-08-29T01:00:58.000Z',
          durationMs: 58_000,
          error: null,
          steps: [],
          modelCalls: [
            {
              ...runningCall,
              status: 'completed',
              completedAt: '2026-08-29T01:00:57.895Z',
              durationMs: 56_895,
              reasoningContent: '先核对转写，再检查知识证据。继续检查成交风险。',
            },
          ],
          toolCalls: [],
        },
      ],
    });
    await act(async () => {
      streamOptions?.onEvent({
        type: 'heartbeat',
        cursor: '4',
        audioFileId: analysisFixture.audioFileId,
        analysisRevisionId: analysisFixture.id,
        occurredAt: '2026-08-29T01:01:00.000Z',
      });
    });
    await waitFor(() => expect(workspaceApi.getAudioExecutionTrace).toHaveBeenCalledTimes(2));
    fireEvent.press(await screen.findByText('业务分析'));
    expect(await screen.findByText('第 1 次 · 成功 · 57 秒')).toBeTruthy();
  });

  it('renders an actionable state for unknown detail ids', async () => {
    const onBack = jest.fn();
    jest
      .mocked(workspaceApi.getAudioAnalysis)
      .mockRejectedValueOnce(new Error('请求的数据不存在。'));
    const screen = await renderAnalysis('missing', onBack);

    expect(screen.getByText('未找到分析详情')).toBeTruthy();
    fireEvent.press(screen.getByText('返回分组'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
