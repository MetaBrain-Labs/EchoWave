/**
 * API 服务状态卡片测试。
 *
 * 验证加载、在线、失败和重试状态的可访问渲染。
 *
 * Responsibilities:
 * - 覆盖状态卡片的用户可观察行为。
 *
 * Notes:
 * - 健康检查请求使用 mock 实现。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { fetchServerHealth } from '../apiClient';
import { ServiceStatusCard } from '../ServiceStatusCard';
import { colors, radii, spacing } from '@/shared/theme/tokens';

jest.mock('../apiClient', () => ({
  fetchServerHealth: jest.fn(),
}));
jest.mock('@/shared/api/ServerConnectionProvider', () => ({
  useServerConnection: () => ({ serverUrl: 'http://localhost:3001' }),
}));

const mockedFetchServerHealth = jest.mocked(fetchServerHealth);
const health = {
  name: 'EchoWave' as const,
  service: 'echowave-api' as const,
  version: '0.1.0',
  apiVersion: 1 as const,
  status: 'ok' as const,
  capabilities: { remotePush: false },
};

describe('ServiceStatusCard', () => {
  beforeEach(() => {
    mockedFetchServerHealth.mockReset();
  });

  it('shows the online state and API message', async () => {
    mockedFetchServerHealth.mockResolvedValue(health);

    const screen = render(<ServiceStatusCard onChangeServer={() => undefined} />);

    await waitFor(() => expect(screen.getByText('EchoWave 0.1.0 · API v1')).toBeTruthy());
    expect(screen.getByLabelText('在线')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('service-status-card').props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: colors.card,
        borderColor: colors.divider,
        borderRadius: radii.default,
        padding: spacing.md,
      }),
    );
  });

  it('shows an offline state and retries the request', async () => {
    mockedFetchServerHealth
      .mockRejectedValueOnce(new Error('无法连接 EchoWave API。'))
      .mockResolvedValueOnce(health);

    const screen = render(<ServiceStatusCard onChangeServer={() => undefined} />);

    await waitFor(() => expect(screen.getByLabelText('离线')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('重试连接'));

    await waitFor(() => expect(screen.getByLabelText('在线')).toBeTruthy());
    expect(mockedFetchServerHealth).toHaveBeenCalledTimes(2);
  });
});
