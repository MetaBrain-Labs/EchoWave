/**
 * 知识问答动态进度卡片测试。
 *
 * 使用受控计时器验证展示阶段顺序、最终引用数量与卸载清理。
 *
 * Responsibilities:
 * - 防止动态反馈阶段停滞或错序。
 * - 保证减少动态效果模式下不遗留动画计时器。
 */
import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { AnswerProgressCard } from '../AnswerProgressCard';

describe('AnswerProgressCard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<
        typeof AccessibilityInfo.addEventListener
      >);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('advances through waiting stages and ends with verified source count', async () => {
    const onProgressChange = jest.fn();
    const screen = render(<AnswerProgressCard onProgressChange={onProgressChange} />);
    await act(async () => Promise.resolve());

    expect(screen.getByLabelText('唤醒 AI')).toBeTruthy();
    act(() => jest.advanceTimersByTime(350));
    expect(screen.getByLabelText('连接知识库')).toBeTruthy();
    act(() => jest.advanceTimersByTime(550));
    expect(screen.getByLabelText('检索知识库')).toBeTruthy();
    act(() => jest.advanceTimersByTime(700));
    expect(screen.getByLabelText('生成结果中')).toBeTruthy();

    screen.rerender(<AnswerProgressCard onProgressChange={onProgressChange} sourceCount={3} />);
    expect(screen.getByLabelText('已确认 3 条引用来源')).toBeTruthy();
    screen.unmount();
  });
});
