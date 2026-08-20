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
import { fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { fontFamilies, textColors } from '../../../theme/tokens';
import { AnalysisDetailScreen } from '../AnalysisDetailScreen';
import { setHideIrrelevantSegmentsPreference } from '../preferences';

describe('AnalysisDetailScreen', () => {
  beforeEach(() => {
    setHideIrrelevantSegmentsPreference(false);
  });

  it('renders transcript content and toggles invalid segments', () => {
    const screen = render(
      <AnalysisDetailScreen detailId="audio-1" onBack={jest.fn()} />,
    );

    expect(screen.getByText('1. 开场与访谈背景')).toBeTruthy();
    expect(screen.getByText('已跳过 12 秒无效片段')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByText('转写分析').props.style)).toEqual(
      expect.objectContaining({ paddingBottom: 4 }),
    );

    fireEvent.press(screen.getByText('跳过无效音频'));

    expect(screen.queryByText('已跳过 12 秒无效片段')).toBeNull();
  });

  it('uses the approved display title and Kai transcript semantics', () => {
    const screen = render(
      <AnalysisDetailScreen detailId="audio-1" onBack={jest.fn()} />,
    );
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

  it('operates the mock player and collapses it on summary', () => {
    const screen = render(
      <AnalysisDetailScreen detailId="audio-1" onBack={jest.fn()} />,
    );

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

  it('switches analysis pages with a horizontal swipe', () => {
    const screen = render(
      <AnalysisDetailScreen detailId="audio-1" onBack={jest.fn()} />,
    );

    fireEvent.press(screen.getByLabelText('展开播放器'));
    fireEvent(screen.getByTestId('analysis-tab-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 480, y: 0 } },
    });

    expect(
      screen.getByRole('tab', { name: '分析总结' }).props.accessibilityState,
    ).toEqual({ selected: true });
    expect(screen.queryByLabelText('收起播放器')).toBeNull();
  });

  it('opens and closes the selected AI tag sheet', () => {
    const screen = render(
      <AnalysisDetailScreen detailId="audio-1" onBack={jest.fn()} />,
    );

    fireEvent.press(
      screen.getByLabelText('查看 AI 标签：高频访谈记录场景'),
    );

    expect(screen.getByText('高频访谈记录场景')).toBeTruthy();
    expect(screen.getByText('隐藏无关片段')).toBeTruthy();

    fireEvent.press(screen.getByText('隐藏无关片段'));
    fireEvent.press(screen.getByLabelText('收起 AI 标签面板'));

    expect(screen.queryByText('高频访谈记录场景')).toBeNull();
  });

  it('dims unrelated paragraphs and hides them on request', () => {
    const screen = render(
      <AnalysisDetailScreen detailId="audio-1" onBack={jest.fn()} />,
    );
    const selectedText =
      '今天想和你聊聊最近使用团队音频整理工具的体验。先从日常工作开始，你通常会在什么场景下记录和回听访谈？';
    const unrelatedText =
      '最常见的是用户访谈和每周复盘。我会先完整录音，结束后再回听并整理重点，但在很长的录音里寻找关键内容会花不少时间。';

    fireEvent.press(
      screen.getByLabelText('查看 AI 标签：高频访谈记录场景'),
    );

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

  it('keeps the hide preference across analysis records in the app session', () => {
    const firstScreen = render(
      <AnalysisDetailScreen detailId="audio-1" onBack={jest.fn()} />,
    );

    fireEvent.press(
      firstScreen.getByLabelText('查看 AI 标签：高频访谈记录场景'),
    );
    fireEvent.press(firstScreen.getByText('隐藏无关片段'));
    firstScreen.unmount();

    const secondScreen = render(
      <AnalysisDetailScreen detailId="audio-2" onBack={jest.fn()} />,
    );
    fireEvent.press(
      secondScreen.getByLabelText('查看 AI 标签：高频访谈记录场景'),
    );

    expect(
      secondScreen.getByRole('checkbox', { name: '隐藏无关片段' }).props
        .accessibilityState,
    ).toEqual({ checked: true });
  });

  it('keeps the fixed preference row outside the independently scrollable panel', () => {
    const screen = render(
      <AnalysisDetailScreen detailId="audio-1" onBack={jest.fn()} />,
    );

    fireEvent.press(
      screen.getByLabelText('查看 AI 标签：高频访谈记录场景'),
    );

    expect(
      within(screen.getByTestId('ai-tag-fixed-header')).getByText(
        '隐藏无关片段',
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('ai-tag-scroll-content')).queryByText(
        '隐藏无关片段',
      ),
    ).toBeNull();
  });

  it('limits the analysis panel according to the audio player state', () => {
    const screen = render(
      <AnalysisDetailScreen detailId="audio-1" onBack={jest.fn()} />,
    );
    const openTag = () =>
      fireEvent.press(
        screen.getByLabelText('查看 AI 标签：高频访谈记录场景'),
      );

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

  it('renders an actionable state for unknown detail ids', () => {
    const onBack = jest.fn();
    const screen = render(
      <AnalysisDetailScreen detailId="missing" onBack={onBack} />,
    );

    expect(screen.getByText('未找到分析详情')).toBeTruthy();
    fireEvent.press(screen.getByText('返回分组'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
