/**
 * “更多”页服务状态摘要卡测试。
 *
 * 验证在线、离线降级、运行模式可用性原因与详情入口。
 *
 * Responsibilities:
 * - 锁定只读摘要的文字内容与失败降级。
 * - 锁定摘要卡进入服务状态详情的导航回调。
 *
 * Notes:
 * - 健康检查与运行模式都使用内存替身，不发起网络请求。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';
import { fetchServerHealth } from '@/shared/api/serverHealth';
import { ServiceSummaryCard } from '../ServiceSummaryCard';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/shared/api/serverHealth', () => ({ fetchServerHealth: jest.fn() }));
jest.mock('@/shared/api/audioRuntimeApi', () => ({ getAudioRuntime: jest.fn() }));
jest.mock('@/shared/api/ServerConnectionProvider', () => ({
  useServerConnection: () => ({ serverUrl: 'http://localhost:3001' }),
}));

const mockedHealth = jest.mocked(fetchServerHealth);
const mockedRuntime = jest.mocked(getAudioRuntime);

const runtimeOverview = {
  mode: 'hybrid' as const,
  revision: 1,
  retention: { originalRetentionDays: null, intermediateRetentionHours: 24 },
  modes: [
    { mode: 'hybrid' as const, available: true, unavailableReason: null },
    { mode: 'object_storage' as const, available: false, unavailableReason: '尚未绑定对象存储。' },
    { mode: 'lightweight_local' as const, available: true, unavailableReason: null },
  ],
};

describe('ServiceSummaryCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRuntime.mockResolvedValue(runtimeOverview);
  });

  it('shows the online server and current runtime mode without leaving the more page', async () => {
    mockedHealth.mockResolvedValue({
      name: 'EchoWave',
      service: 'echowave-api',
      version: '0.3.0',
      apiVersion: 1,
      status: 'ok',
      capabilities: { remotePush: false },
    } as never);

    const screen = render(<ServiceSummaryCard onOpenDetails={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('EchoWave 0.3.0')).toBeTruthy());
    expect(screen.getByLabelText('在线')).toBeTruthy();
    expect(screen.getByText(/混合存储模式/)).toBeTruthy();
  });

  it('degrades to offline without hiding the runtime row', async () => {
    mockedHealth.mockRejectedValue(new Error('无法连接服务器。'));

    const screen = render(<ServiceSummaryCard onOpenDetails={jest.fn()} />);

    await waitFor(() => expect(screen.getByLabelText('离线')).toBeTruthy());
    expect(screen.getByText('无法连接服务器')).toBeTruthy();
    expect(screen.getByText(/混合存储模式/)).toBeTruthy();
  });

  it('falls back to an unknown runtime label when the runtime request fails', async () => {
    mockedHealth.mockResolvedValue({
      name: 'EchoWave',
      service: 'echowave-api',
      version: '0.3.0',
      apiVersion: 1,
      status: 'ok',
      capabilities: { remotePush: false },
    } as never);
    mockedRuntime.mockRejectedValue(new Error('runtime unavailable'));

    const screen = render(<ServiceSummaryCard onOpenDetails={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('暂时无法读取')).toBeTruthy());
  });

  it('opens the full service status details when pressed', async () => {
    mockedHealth.mockResolvedValue({
      name: 'EchoWave',
      service: 'echowave-api',
      version: '0.3.0',
      apiVersion: 1,
      status: 'ok',
      capabilities: { remotePush: false },
    } as never);
    const onOpenDetails = jest.fn();
    const screen = render(<ServiceSummaryCard onOpenDetails={onOpenDetails} />);

    fireEvent.press(await screen.findByLabelText('打开服务状态详情'));

    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });
});
