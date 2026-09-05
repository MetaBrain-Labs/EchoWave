/**
 * 应用级推送登记生命周期测试。
 *
 * 验证服务端能力、串行去重、服务器切换、前台重试和可诊断失败状态。
 *
 * Responsibilities:
 * - 锁定自动登记与手动重试共用同一串行任务。
 * - 锁定连接修订和 App 回到前台会重新确认服务端登记。
 */
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';

import { fetchServerHealth } from '@/shared/api/serverHealth';
import { useServerConnection } from '@/shared/api/ServerConnectionProvider';

import {
  PushNotificationProvider,
  usePushNotificationRegistration,
} from '../PushNotificationProvider';
import { PushRegistrationError, registerPushDevice } from '../pushNotifications';

jest.mock('@/shared/api/serverHealth', () => ({ fetchServerHealth: jest.fn() }));
jest.mock('@/shared/api/ServerConnectionProvider', () => ({ useServerConnection: jest.fn() }));
jest.mock('../pushNotifications', () => {
  const actual = jest.requireActual('../pushNotifications');
  return { ...actual, registerPushDevice: jest.fn() };
});

const mockedHealth = jest.mocked(fetchServerHealth);
const mockedConnection = jest.mocked(useServerConnection);
const mockedRegister = jest.mocked(registerPushDevice);

let refreshRegistration: (() => Promise<void>) | undefined;
let foregroundHandler: ((state: AppStateStatus) => void) | undefined;
let connection = {
  error: null,
  phase: 'ready' as const,
  revision: 0,
  serverUrl: 'http://192.168.1.10:3001',
  retryHydration: jest.fn(),
  saveServerUrl: jest.fn(),
};

function RegistrationStateProbe() {
  const value = usePushNotificationRegistration();
  useEffect(() => {
    refreshRegistration = value.refresh;
  }, [value.refresh]);
  return <Text>{`${value.state.phase}|${value.state.errorCode ?? ''}`}</Text>;
}

describe('PushNotificationProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    refreshRegistration = undefined;
    foregroundHandler = undefined;
    connection = { ...connection, revision: 0, serverUrl: 'http://192.168.1.10:3001' };
    mockedConnection.mockImplementation(() => connection);
    mockedHealth.mockResolvedValue({
      name: 'EchoWave',
      service: 'echowave-api',
      version: '0.1.0',
      apiVersion: 1,
      status: 'ok',
      capabilities: { remotePush: true },
    });
    mockedRegister.mockResolvedValue({
      status: 'registered',
      deviceId: '10000000-0000-4000-8000-000000000001',
      platform: 'android',
    });
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event: string, handler: (state: AppStateStatus) => void) => {
        foregroundHandler = handler;
        return { remove: jest.fn() };
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows server-disabled without attempting device registration', async () => {
    mockedHealth.mockResolvedValue({
      name: 'EchoWave',
      service: 'echowave-api',
      version: '0.1.0',
      apiVersion: 1,
      status: 'ok',
      capabilities: { remotePush: false },
    });

    const screen = render(
      <PushNotificationProvider>
        <RegistrationStateProbe />
      </PushNotificationProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText('server_disabled|REMOTE_PUSH_DISABLED')).toBeTruthy(),
    );
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent manual registration attempts', async () => {
    let resolveRegistration: (() => void) | undefined;
    mockedRegister.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRegistration = () =>
            resolve({
              status: 'registered',
              deviceId: '10000000-0000-4000-8000-000000000001',
              platform: 'android',
            });
        }),
    );

    const screen = render(
      <PushNotificationProvider>
        <RegistrationStateProbe />
      </PushNotificationProvider>,
    );
    await waitFor(() => expect(mockedRegister).toHaveBeenCalledTimes(1));

    await act(async () => {
      const first = refreshRegistration?.();
      const second = refreshRegistration?.();
      expect(first).toBe(second);
      resolveRegistration?.();
      await first;
    });

    await waitFor(() => expect(screen.getByText('registered|')).toBeTruthy());
    expect(mockedRegister).toHaveBeenCalledTimes(1);
  });

  it('surfaces retryable API registration failures with their stable code', async () => {
    mockedRegister.mockRejectedValue(
      new PushRegistrationError('TIMEOUT', '设备登记请求超时。', true),
    );

    const screen = render(
      <PushNotificationProvider>
        <RegistrationStateProbe />
      </PushNotificationProvider>,
    );

    await waitFor(() => expect(screen.getByText('failed|TIMEOUT')).toBeTruthy());
  });

  it('registers again after a server switch and when the App returns to foreground', async () => {
    const screen = render(
      <PushNotificationProvider>
        <RegistrationStateProbe />
      </PushNotificationProvider>,
    );
    await waitFor(() => expect(mockedRegister).toHaveBeenCalledTimes(1));

    connection = {
      ...connection,
      revision: 1,
      serverUrl: 'http://192.168.1.11:3001',
    };
    screen.rerender(
      <PushNotificationProvider>
        <RegistrationStateProbe />
      </PushNotificationProvider>,
    );
    await waitFor(() => expect(mockedRegister).toHaveBeenCalledTimes(2));

    await act(async () => foregroundHandler?.('active'));
    await waitFor(() => expect(mockedRegister).toHaveBeenCalledTimes(3));
  });
});
