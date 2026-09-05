/**
 * 运行时服务器连接状态测试。
 *
 * 验证持久化恢复、首次未配置、保存切换与存储失败状态。
 *
 * Responsibilities:
 * - 锁定业务路由挂载前的地址水合行为。
 *
 * Notes:
 * - AsyncStorage 使用内存替身，不写入真实设备。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text, Pressable } from 'react-native';

import {
  SERVER_URL_STORAGE_KEY,
  ServerConnectionProvider,
  useServerConnection,
} from '../ServerConnectionProvider';
import { getApiUrl } from '../serverUrl';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

function Probe() {
  const connection = useServerConnection();
  return (
    <>
      <Text>{connection.phase}</Text>
      <Text>{connection.serverUrl ?? 'none'}</Text>
      <Text>{connection.error ?? 'no-error'}</Text>
      <Pressable
        accessibilityLabel="保存测试服务器"
        onPress={() => void connection.saveServerUrl('http://192.168.1.7:3001')}
      />
    </>
  );
}

describe('ServerConnectionProvider', () => {
  const getItem = jest.mocked(AsyncStorage.getItem);
  const setItem = jest.mocked(AsyncStorage.setItem);
  const originalDevelopmentUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_API_URL = 'invalid';
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue();
  });

  afterAll(() => {
    if (originalDevelopmentUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalDevelopmentUrl;
  });

  it('requires first-run configuration when no saved or development address exists', async () => {
    const screen = render(
      <ServerConnectionProvider>
        <Probe />
      </ServerConnectionProvider>,
    );
    await waitFor(() => expect(screen.getByText('unconfigured')).toBeTruthy());
    expect(screen.getByText('none')).toBeTruthy();
  });

  it('uses the development environment address when storage is empty', async () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.9:3001/';
    const screen = render(
      <ServerConnectionProvider>
        <Probe />
      </ServerConnectionProvider>,
    );
    await waitFor(() => expect(screen.getByText('ready')).toBeTruthy());
    expect(screen.getByText('http://192.168.1.9:3001')).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('restores a saved address and updates the runtime source when changed', async () => {
    getItem.mockResolvedValue('https://api.example.com/');
    const screen = render(
      <ServerConnectionProvider>
        <Probe />
      </ServerConnectionProvider>,
    );
    await waitFor(() => expect(screen.getByText('https://api.example.com')).toBeTruthy());
    expect(getApiUrl()).toBe('https://api.example.com');

    await act(async () => fireEvent.press(screen.getByLabelText('保存测试服务器')));
    await waitFor(() => expect(screen.getByText('http://192.168.1.7:3001')).toBeTruthy());
    expect(setItem).toHaveBeenCalledWith(SERVER_URL_STORAGE_KEY, 'http://192.168.1.7:3001');
    expect(getApiUrl()).toBe('http://192.168.1.7:3001');
  });

  it('exposes storage read failures instead of mounting business routes', async () => {
    getItem.mockRejectedValue(new Error('storage unavailable'));
    const screen = render(
      <ServerConnectionProvider>
        <Probe />
      </ServerConnectionProvider>,
    );
    await waitFor(() => expect(screen.getByText('error')).toBeTruthy());
    expect(screen.getByText('无法读取本机服务器设置，请重试。')).toBeTruthy();
  });
});
