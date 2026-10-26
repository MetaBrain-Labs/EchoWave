/**
 * 工作区环境背景交互测试。
 *
 * 验证装饰背景遵循动态效果偏好和应用前后台状态，并在卸载时清理动画监听。
 *
 * Responsibilities:
 * - 锁定减少动态效果与后台暂停行为。
 * - 验证背景不拦截内容点击。
 * - 验证动画和系统事件订阅在卸载时释放。
 *
 * Notes:
 * - 通过可控动画与系统事件替身避免依赖设备时钟。
 */
import { act, render, waitFor } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';
import { cancelAnimation, withRepeat } from 'react-native-reanimated';

import { WorkspaceAmbientBackground } from '../WorkspaceAmbientBackground';

jest.mock('react-native-reanimated', () => {
  const ReactNative = jest.requireActual('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    cancelAnimation: jest.fn(),
    default: { View: ReactNative.View },
    Easing: { inOut: (value: unknown) => value, sin: 'sin' },
    interpolate: (value: number) => value,
    useAnimatedStyle: (styleFactory: () => unknown) => styleFactory(),
    useSharedValue: (value: number) => ({ value }),
    withRepeat: jest.fn((animation: unknown) => animation),
    withTiming: jest.fn((value: number) => ({ value })),
  };
});

let appStateListener: ((state: AppStateStatus) => void) | undefined;
let reducedMotionListener: ((enabled: boolean) => void) | undefined;
const removeAppStateListener = jest.fn();
const removeReducedMotionListener = jest.fn();

beforeEach(() => {
  appStateListener = undefined;
  reducedMotionListener = undefined;
  removeAppStateListener.mockClear();
  removeReducedMotionListener.mockClear();
  jest.mocked(cancelAnimation).mockClear();
  jest.mocked(withRepeat).mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
    event: string,
    listener: (value: unknown) => void,
  ) => {
    if (event === 'reduceMotionChanged') {
      reducedMotionListener = listener as (enabled: boolean) => void;
    }
    return { remove: removeReducedMotionListener } as never;
  }) as unknown as typeof AccessibilityInfo.addEventListener);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: removeAppStateListener } as NativeEventSubscription;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('WorkspaceAmbientBackground', () => {
  it('pauses in the background, respects reduced motion and lets page interactions pass through', async () => {
    const screen = render(<WorkspaceAmbientBackground />);
    expect(screen.getByTestId('workspace-ambient-background').props.pointerEvents).toBe('none');

    await waitFor(() => expect(appStateListener).toBeDefined());
    act(() => appStateListener?.('active'));
    await waitFor(() => expect(withRepeat).toHaveBeenCalledTimes(3));
    jest.mocked(cancelAnimation).mockClear();

    act(() => appStateListener?.('background'));
    expect(cancelAnimation).toHaveBeenCalledTimes(6);
    expect(withRepeat).toHaveBeenCalledTimes(3);

    act(() => appStateListener?.('active'));
    await waitFor(() => expect(withRepeat).toHaveBeenCalledTimes(6));
    jest.mocked(cancelAnimation).mockClear();

    act(() => reducedMotionListener?.(true));
    expect(cancelAnimation).toHaveBeenCalledTimes(6);
    expect(withRepeat).toHaveBeenCalledTimes(6);

    screen.unmount();
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
    expect(removeReducedMotionListener).toHaveBeenCalledTimes(1);
  });

  it('cancels running animations when the background unmounts', async () => {
    const screen = render(<WorkspaceAmbientBackground />);
    await waitFor(() => expect(appStateListener).toBeDefined());
    act(() => appStateListener?.('active'));
    await waitFor(() => expect(withRepeat).toHaveBeenCalledTimes(3));
    jest.mocked(cancelAnimation).mockClear();

    screen.unmount();

    expect(cancelAnimation).toHaveBeenCalledTimes(3);
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
    expect(removeReducedMotionListener).toHaveBeenCalledTimes(1);
  });
});
