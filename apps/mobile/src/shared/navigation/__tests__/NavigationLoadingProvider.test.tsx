/**
 * 导航加载状态测试。
 *
 * 验证 provider 的任务计数、延迟展示和遮罩收口，防止快速请求闪烁或并发请求提前消失。
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
  navigationLoadingDelayMs,
  NavigationLoadingProvider,
  useNavigationLoading,
} from '../NavigationLoadingProvider';

function LoadingTrigger({ operation }: { operation: () => void | Promise<void> }) {
  const { runWithLoading } = useNavigationLoading();
  return (
    <Pressable onPress={() => void runWithLoading(operation).catch(() => undefined)}>
      <Text>跳转</Text>
    </Pressable>
  );
}

describe('NavigationLoadingProvider', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not show the overlay when the request finishes within the delay', async () => {
    const operation = jest.fn().mockResolvedValue(undefined);
    const screen = render(
      <NavigationLoadingProvider>
        <LoadingTrigger operation={operation} />
      </NavigationLoadingProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByText('跳转'));
      await Promise.resolve();
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('页面正在加载')).toBeNull();

    act(() => jest.advanceTimersByTime(navigationLoadingDelayMs));
    expect(screen.queryByLabelText('页面正在加载')).toBeNull();
  });

  it('keeps the overlay visible until every concurrent request settles', async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    const screen = render(
      <NavigationLoadingProvider>
        <LoadingTrigger operation={() => first} />
        <LoadingTrigger operation={() => second} />
      </NavigationLoadingProvider>,
    );

    screen.getAllByText('跳转').forEach((trigger) => fireEvent.press(trigger));
    act(() => jest.advanceTimersByTime(navigationLoadingDelayMs));
    expect(screen.getByLabelText('页面正在加载')).toBeTruthy();
    expect(screen.getByTestId('lively-loading-mark')).toBeTruthy();

    await act(async () => finishFirst());
    expect(screen.getByLabelText('页面正在加载')).toBeTruthy();

    await act(async () => finishSecond());
    expect(screen.queryByLabelText('页面正在加载')).toBeNull();
  });

  it('closes the overlay immediately when a slow request rejects', async () => {
    let rejectRequest!: (reason: Error) => void;
    const request = new Promise<void>((_, reject) => {
      rejectRequest = reject;
    });
    const screen = render(
      <NavigationLoadingProvider>
        <LoadingTrigger operation={() => request} />
      </NavigationLoadingProvider>,
    );

    fireEvent.press(screen.getByText('跳转'));
    act(() => jest.advanceTimersByTime(navigationLoadingDelayMs));
    expect(screen.getByLabelText('页面正在加载')).toBeTruthy();

    await act(async () => rejectRequest(new Error('request failed')));
    expect(screen.queryByLabelText('页面正在加载')).toBeNull();
  });
});
