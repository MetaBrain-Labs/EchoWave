/**
 * 管理员会话 Provider 回归测试。
 *
 * 验证口令只在内存共享、换服务器即失效，且不写入设备存储。
 *
 * Responsibilities:
 * - 锁定跨页面共用一个已校验口令。
 * - 锁定 revision 变化与显式清理都会回到未验证状态。
 *
 * Notes:
 * - 不使用真实网络；仅渲染内存状态。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AdminSessionProvider, useAdminSession } from '../AdminSessionProvider';

/** 暴露当前会话口令，便于断言共享与失效。 */
function SessionProbe() {
  const { token } = useAdminSession();
  return <Text testID="session-token">{token ?? 'none'}</Text>;
}

/** 通过按钮写入一个待校验口令。 */
function SessionWriter({ value }: { value: string }) {
  const { setSession } = useAdminSession();
  return <Text onPress={() => setSession(value)}>写入</Text>;
}

/** 通过按钮显式清理会话。 */
function SessionClearer() {
  const { clearSession } = useAdminSession();
  return <Text onPress={clearSession}>清理</Text>;
}

/** 承载可变的服务器 revision，模拟服务器切换而不卸载 Provider。 */
function Harness({ revision, value }: { revision: number; value: string }) {
  return (
    <AdminSessionProvider serverRevision={revision}>
      <SessionWriter value={value} />
      <SessionClearer />
      <SessionProbe />
    </AdminSessionProvider>
  );
}

describe('AdminSessionProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shares one trimmed token across every consumer', async () => {
    const screen = render(<Harness revision={0} value="  admin-token  " />);

    expect(screen.getByTestId('session-token')).toHaveTextContent('none');
    fireEvent.press(screen.getByText('写入'));
    await waitFor(() =>
      expect(screen.getByTestId('session-token')).toHaveTextContent('admin-token'),
    );
  });

  it('drops the token when the server revision changes', async () => {
    const screen = render(<Harness revision={0} value="admin-token" />);
    fireEvent.press(screen.getByText('写入'));
    await waitFor(() =>
      expect(screen.getByTestId('session-token')).toHaveTextContent('admin-token'),
    );

    screen.rerender(<Harness revision={1} value="admin-token" />);
    await waitFor(() => expect(screen.getByTestId('session-token')).toHaveTextContent('none'));
  });

  it('clears the session on demand and never persists it', async () => {
    const screen = render(<Harness revision={0} value="admin-token" />);
    fireEvent.press(screen.getByText('写入'));
    await waitFor(() =>
      expect(screen.getByTestId('session-token')).toHaveTextContent('admin-token'),
    );

    await act(async () => {
      fireEvent.press(screen.getByText('清理'));
    });
    expect(screen.getByTestId('session-token')).toHaveTextContent('none');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});
