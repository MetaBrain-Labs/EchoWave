/**
 * 管理员会话门禁测试。
 *
 * 验证未校验时只显示说明与唯一校验入口，已校验时直接渲染受保护内容。
 *
 * Responsibilities:
 * - 锁定门禁不提供第二处口令输入。
 * - 锁定门禁的跳转回调可被宿主页面接管。
 *
 * Notes:
 * - 只渲染内存会话，不发起任何网络请求。
 */
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { AdminSessionGate } from '../AdminSessionGate';
import { AdminSessionProvider, useAdminSession } from '../AdminSessionProvider';

/** 通过真实上下文写入共享会话。 */
function SeedSession({ token }: { token: string }) {
  const { setSession } = useAdminSession();
  return (
    <Text accessibilityRole="button" onPress={() => setSession(token)}>
      建立共享会话
    </Text>
  );
}

function renderGate(children: ReactElement, { authorized = false } = {}) {
  const onOpenServiceConfiguration = jest.fn();
  const screen = render(
    <AdminSessionProvider serverRevision={0}>
      {authorized ? <SeedSession token="admin-token" /> : null}
      <AdminSessionGate onOpenServiceConfiguration={onOpenServiceConfiguration}>
        {children}
      </AdminSessionGate>
    </AdminSessionProvider>,
  );
  if (authorized) fireEvent.press(screen.getByText('建立共享会话'));
  return { onOpenServiceConfiguration, screen };
}

describe('AdminSessionGate', () => {
  it('renders only the gate with a single verification entry when unverified', () => {
    const { onOpenServiceConfiguration, screen } = renderGate(<Text>受保护内容</Text>);

    expect(screen.getByText('需要管理员校验')).toBeTruthy();
    expect(screen.queryByText('受保护内容')).toBeNull();
    // 门禁本身不提供口令输入，避免出现第二处校验。
    expect(screen.queryByLabelText('管理员口令')).toBeNull();
    expect(screen.queryByLabelText('CONFIGURATION_ADMIN_TOKEN')).toBeNull();

    fireEvent.press(screen.getByLabelText('前往服务配置校验'));
    expect(onOpenServiceConfiguration).toHaveBeenCalledTimes(1);
  });

  it('renders the protected content once the shared session exists', () => {
    const { screen } = renderGate(<Text>受保护内容</Text>, { authorized: true });

    expect(screen.getByText('受保护内容')).toBeTruthy();
    expect(screen.queryByText('需要管理员校验')).toBeNull();
  });
});
