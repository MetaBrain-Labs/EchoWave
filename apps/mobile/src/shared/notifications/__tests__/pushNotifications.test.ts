/**
 * 推送运行时兼容性测试。
 *
 * 验证 Expo Go Android 不会加载远程推送原生模块，从而保证主导航仍可正常启动。
 *
 * Responsibilities:
 * - 锁定 Expo Go 的远程推送降级行为。
 *
 * Notes:
 * - Development Build 的真实 Token 获取需要原生设备，不在 Jest 中伪造。
 */
import { canUseRemotePush, registerPushDevice } from '../pushNotifications';

jest.mock('expo', () => ({
  isRunningInExpoGo: () => true,
}));

jest.mock('expo-notifications', () => {
  throw new Error('expo-notifications must not load in Expo Go');
});

jest.mock('@/shared/api/request', () => ({
  request: jest.fn(),
}));

describe('push notification runtime compatibility', () => {
  it('skips remote notification module loading in Expo Go', async () => {
    expect(canUseRemotePush()).toBe(false);
    await expect(registerPushDevice()).resolves.toBeUndefined();
  });
});
