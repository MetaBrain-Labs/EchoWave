/**
 * 导航加载状态测试。
 *
 * 验证 provider 的任务计数、最短展示时长和遮罩交互，防止路由切换出现闪烁或提前消失。
 *
 * Responsibilities:
 * - 覆盖导航加载状态的可观察行为。
 *
 * Notes:
 * - 使用 fake timer 控制时间相关断言。
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import {
  minimumNavigationLoadingMs,
  NavigationLoadingProvider,
  useNavigationLoading,
} from '../NavigationLoadingProvider';

function LoadingTrigger({ operation }: { operation: () => void | Promise<void> }) {
  const { runWithLoading } = useNavigationLoading();
  return (
    <Pressable onPress={() => void runWithLoading(operation)}>
      <Text>跳转</Text>
    </Pressable>
  );
}

describe('NavigationLoadingProvider', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps route loading visible for the minimum perceptible duration', async () => {
    const operation = jest.fn();
    const screen = render(
      <NavigationLoadingProvider>
        <LoadingTrigger operation={operation} />
      </NavigationLoadingProvider>,
    );

    fireEvent.press(screen.getByText('跳转'));
    expect(operation).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('页面正在加载')).toBeTruthy();
    expect(screen.getByTestId('lively-loading-mark')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(minimumNavigationLoadingMs - 1);
    });
    expect(screen.getByLabelText('页面正在加载')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByLabelText('页面正在加载')).toBeNull();
  });
});
