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

import { fetchHello } from '../apiClient';
import { ServiceStatusCard } from '../ServiceStatusCard';

jest.mock('../apiClient', () => ({
  apiUrl: 'http://localhost:3001',
  fetchHello: jest.fn(),
}));

const mockedFetchHello = jest.mocked(fetchHello);

describe('ServiceStatusCard', () => {
  beforeEach(() => {
    mockedFetchHello.mockReset();
  });

  it('shows the online state and API message', async () => {
    mockedFetchHello.mockResolvedValue({
      ok: true,
      service: 'echowave-api',
      message: 'HelloWorld',
    });

    const screen = render(<ServiceStatusCard />);

    await waitFor(() => expect(screen.getByText('HelloWorld')).toBeTruthy());
    expect(screen.getByLabelText('在线')).toBeTruthy();
  });

  it('shows an offline state and retries the request', async () => {
    mockedFetchHello
      .mockRejectedValueOnce(new Error('无法连接 EchoWave API。'))
      .mockResolvedValueOnce({
        ok: true,
        service: 'echowave-api',
        message: 'HelloWorld',
      });

    const screen = render(<ServiceStatusCard />);

    await waitFor(() => expect(screen.getByLabelText('离线')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('重试连接'));

    await waitFor(() => expect(screen.getByLabelText('在线')).toBeTruthy());
    expect(mockedFetchHello).toHaveBeenCalledTimes(2);
  });
});
