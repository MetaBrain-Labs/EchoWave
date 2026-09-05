/**
 * 服务器连接页面交互测试。
 *
 * 验证地址门禁、健康探测、编辑失效与成功保存。
 *
 * Responsibilities:
 * - 覆盖首次连接的关键用户路径和失败反馈。
 *
 * Notes:
 * - 网络与持久化均使用测试替身。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { fetchServerHealth } from '@/shared/api/serverHealth';
import { ServerConnectionScreen } from '../ServerConnectionScreen';

const mockSaveServerUrl = jest.fn();
jest.mock('@/shared/api/ServerConnectionProvider', () => ({
  useServerConnection: () => ({ saveServerUrl: mockSaveServerUrl, serverUrl: null }),
}));
jest.mock('@/shared/api/serverHealth', () => ({ fetchServerHealth: jest.fn() }));

const health = {
  name: 'EchoWave' as const,
  service: 'echowave-api' as const,
  version: '0.1.0',
  apiVersion: 1 as const,
  status: 'ok' as const,
  capabilities: { remotePush: false },
};

describe('ServerConnectionScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveServerUrl.mockResolvedValue(undefined);
  });

  it('requires a successful probe and invalidates it after editing', async () => {
    jest.mocked(fetchServerHealth).mockResolvedValue(health);
    const screen = render(<ServerConnectionScreen />);
    const save = screen.getByLabelText('保存并继续');
    expect(save.props.accessibilityState?.disabled ?? save.props.disabled).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('服务器地址'), 'http://192.168.1.7:3001/');
    fireEvent.press(screen.getByLabelText('测试连接'));
    await waitFor(() => expect(screen.getByText('连接成功 · EchoWave 0.1.0')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('保存并继续'));
    await waitFor(() => expect(mockSaveServerUrl).toHaveBeenCalledWith('http://192.168.1.7:3001'));

    fireEvent.changeText(screen.getByLabelText('服务器地址'), 'http://192.168.1.8:3001');
    expect(screen.queryByText('连接成功 · EchoWave 0.1.0')).toBeNull();
  });

  it('rejects public cleartext addresses before making a request', async () => {
    const screen = render(<ServerConnectionScreen />);
    fireEvent.changeText(screen.getByLabelText('服务器地址'), 'http://api.example.com');
    fireEvent.press(screen.getByLabelText('测试连接'));
    await waitFor(() => expect(screen.getByText('公网服务器必须使用 HTTPS。')).toBeTruthy());
    expect(fetchServerHealth).not.toHaveBeenCalled();
  });
});
