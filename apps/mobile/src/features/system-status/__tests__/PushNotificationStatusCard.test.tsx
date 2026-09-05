/**
 * 推送登记状态卡片测试。
 *
 * 验证设备已登记、可诊断失败和手动重试的用户可观察行为。
 *
 * Responsibilities:
 * - 锁定状态文案、错误代码和重试入口。
 * - 确保页面不渲染 Expo Push Token。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { usePushNotificationRegistration } from '@/shared/notifications/PushNotificationProvider';

import { PushNotificationStatusCard } from '../PushNotificationStatusCard';

jest.mock('@/shared/notifications/PushNotificationProvider', () => ({
  usePushNotificationRegistration: jest.fn(),
}));

const mockedUsePushRegistration = jest.mocked(usePushNotificationRegistration);

describe('PushNotificationStatusCard', () => {
  it('shows an authoritative registered state without exposing a token', () => {
    mockedUsePushRegistration.mockReturnValue({
      state: {
        phase: 'registered',
        message: '设备已登记，可接收新分析批次的远程通知。',
        serverCapability: 'enabled',
        systemPermission: 'granted',
        deviceRegistration: 'registered',
        lastAttemptAt: '2026-09-06T00:00:00.000Z',
        errorCode: null,
        retryable: false,
      },
      refresh: jest.fn(),
    });

    const screen = render(<PushNotificationStatusCard />);

    expect(screen.getByLabelText('已登记')).toBeTruthy();
    expect(screen.getByText('服务端能力')).toBeTruthy();
    expect(screen.getByText('系统权限')).toBeTruthy();
    expect(screen.getByText('权限说明')).toBeTruthy();
    expect(screen.getByText(/服务端能力需要服务端开启远程推送/)).toBeTruthy();
    expect(screen.getByText(/Google 推送服务/)).toBeTruthy();
    expect(screen.getAllByText('已登记')).toHaveLength(2);
    expect(screen.getByText('设备已登记，可接收新分析批次的远程通知。')).toBeTruthy();
    expect(screen.queryByText(/PushToken/)).toBeNull();
  });

  it('shows a retryable error code and invokes manual registration', () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    mockedUsePushRegistration.mockReturnValue({
      state: {
        phase: 'failed',
        message: '无法获取 Expo Push Token。',
        serverCapability: 'enabled',
        systemPermission: 'granted',
        deviceRegistration: 'failed',
        lastAttemptAt: '2026-09-06T00:00:00.000Z',
        errorCode: 'EXPO_PUSH_TOKEN_FAILED',
        retryable: true,
      },
      refresh,
    });

    const screen = render(<PushNotificationStatusCard />);
    fireEvent.press(screen.getByLabelText('重新登记推送设备'));

    expect(screen.getByLabelText('可重试')).toBeTruthy();
    expect(screen.getByText('代码：EXPO_PUSH_TOKEN_FAILED')).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
