/**
 * 服务端数据页面刷新协调器测试。
 *
 * 验证首次焦点去重、返回页面静默刷新和手动刷新状态。
 *
 * Responsibilities:
 * - 锁定焦点与手动刷新行为。
 *
 * Notes:
 * - 使用轻量测试组件观察 Hook 输出。
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { useScreenRefresh } from '../useScreenRefresh';

let focusCallback: (() => void) | undefined;

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    focusCallback = callback;
  },
}));

function Probe({ refresh }: { refresh: () => Promise<void> }) {
  const state = useScreenRefresh(refresh);
  return (
    <Pressable accessibilityRole="button" onPress={state.onRefresh}>
      <Text>{state.refreshing ? 'refreshing' : 'idle'}</Text>
    </Pressable>
  );
}

describe('useScreenRefresh', () => {
  beforeEach(() => {
    focusCallback = undefined;
  });

  it('skips first focus and refreshes on subsequent focus', async () => {
    const refresh = jest.fn(async () => undefined);
    render(<Probe refresh={refresh} />);

    await act(async () => focusCallback?.());
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => focusCallback?.());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows manual refresh state until the request settles', async () => {
    let resolve!: () => void;
    const refresh = jest.fn(() => new Promise<void>((done) => (resolve = done)));
    const screen = render(<Probe refresh={refresh} />);

    fireEvent.press(screen.getByRole('button'));
    expect(screen.getByText('refreshing')).toBeTruthy();

    await act(async () => resolve());
    expect(screen.getByText('idle')).toBeTruthy();
  });
});
