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
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { fontFamilies, textColors } from '@/shared/theme/tokens';
import { AnalysisDetailScreen } from '../AnalysisDetailScreen';
import { setHideIrrelevantSegmentsPreference } from '../preferences';
import * as workspaceApi from '@/shared/api/workspaceApi';
import { analysisFixture } from '@/test/workspaceFixtures';

jest.mock('@/shared/api/workspaceApi', () => ({
  getAudioAnalysis: jest.fn(),
  startAudioEmotionAnalysis: jest.fn(),
  startAudioRoleRecognition: jest.fn(),
}));

async function renderAnalysis(detailId = analysisFixture.audioFileId, onBack = jest.fn()) {
  const screen = render(<AnalysisDetailScreen detailId={detailId} onBack={onBack} />);
  await waitFor(() => expect(screen.queryByLabelText('正在加载分析详情')).toBeNull());
  return screen;
}

describe('AnalysisDetailScreen', () => {
  beforeEach(() => {
    setHideIrrelevantSegmentsPreference(false);
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValue(analysisFixture);
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

  it('confirms and starts the two post-analysis tasks independently', async () => {
    const screen = await renderAnalysis();

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
    jest.mocked(workspaceApi.getAudioAnalysis).mockResolvedValueOnce({
      ...analysisFixture,
      postAnalysis: {
        emotion: {
          state: 'running',
          jobId: '90000000-0000-4000-8000-000000000001',
          model: 'qwen3.5-omni-flash',
          progress: 45,
        },
        role: {
          state: 'failed',
          jobId: '90000000-0000-4000-8000-000000000002',
          model: 'deepseek-v4-flash',
          code: 'INVALID_MODEL_OUTPUT',
          message: '模型返回格式无效，请重试。',
          retryable: true,
        },
      },
    });
    const screen = await renderAnalysis();

    expect(screen.getByText('分析中 45%')).toBeTruthy();
    expect(screen.getByText('模型返回格式无效，请重试。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新识别' })).toBeTruthy();
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

  it('renders transcript content and toggles invalid segments', async () => {
    const screen = await renderAnalysis();

    expect(screen.getByText('1. 开场与访谈背景')).toBeTruthy();
    expect(screen.getByText('已跳过 12 秒无效片段')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByText('转写分析').props.style)).toEqual(
      expect.objectContaining({ paddingBottom: 4 }),
    );

    fireEvent.press(screen.getByText('跳过无效音频'));

    expect(screen.queryByText('已跳过 12 秒无效片段')).toBeNull();
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

  it('operates the mock player and collapses it on summary', async () => {
    const screen = await renderAnalysis();

    fireEvent.press(screen.getByLabelText('展开播放器'));
    expect(screen.getByLabelText('收起播放器')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('前进 15 秒'));
    expect(screen.getByText('00:15')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('后退 15 秒'));
    expect(screen.queryByText('00:15')).toBeNull();

    fireEvent.press(screen.getByLabelText('当前倍速 1.0 倍，点击切换'));
    expect(screen.getByText('x1.5')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('开始模拟播放'));
    expect(screen.getByLabelText('暂停模拟播放')).toBeTruthy();

    fireEvent.press(screen.getByText('分析总结'));
    expect(screen.queryByLabelText('收起播放器')).toBeNull();
    expect(screen.getByText('产品访谈分析')).toBeTruthy();
  });

  it('switches analysis pages with a horizontal swipe', async () => {
    const screen = await renderAnalysis();

    fireEvent.press(screen.getByLabelText('展开播放器'));
    fireEvent(screen.getByTestId('analysis-tab-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 480, y: 0 } },
    });

    expect(screen.getByRole('tab', { name: '分析总结' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.queryByLabelText('收起播放器')).toBeNull();
  });

  it('opens and closes the selected AI tag sheet', async () => {
    const screen = await renderAnalysis();

    fireEvent.press(screen.getByLabelText('查看 AI 标签：高频访谈记录场景'));

    expect(screen.getByText('高频访谈记录场景')).toBeTruthy();
    expect(screen.getByText('隐藏无关片段')).toBeTruthy();

    fireEvent.press(screen.getByText('隐藏无关片段'));
    fireEvent.press(screen.getByLabelText('收起 AI 标签面板'));

    expect(screen.queryByText('高频访谈记录场景')).toBeNull();
  });

  it('embeds the AI tag control in its transcript timeline rail', async () => {
    const screen = await renderAnalysis();
    const segmentId = analysisFixture.scenes[0].segments[0].id;
    const rail = screen.getByTestId(`timeline-rail-${segmentId}`);

    expect(within(rail).getByLabelText('查看 AI 标签：高频访谈记录场景')).toBeTruthy();
    expect(screen.getByTestId(`ai-tag-timeline-marker-${segmentId}`)).toBeTruthy();
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
