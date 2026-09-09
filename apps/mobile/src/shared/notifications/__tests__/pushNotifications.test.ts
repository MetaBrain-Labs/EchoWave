/**
 * 推送设备登记测试。
 *
 * 验证运行时降级、系统权限、Expo Token 获取与 EchoWave API 登记的可诊断结果。
 *
 * Responsibilities:
 * - 锁定 Android Channel、权限、Token 和 API 的串行顺序。
 * - 确保错误正文不会泄露 Expo Push Token。
 */
import { Platform } from 'react-native';

import { request, WorkspaceRequestError } from '@/shared/api/request';

import { canUseRemotePush, PushRegistrationError, registerPushDevice } from '../pushNotifications';

let mockExpoGo = false;
const mockNotifications = {
  AndroidImportance: { HIGH: 4 },
  getExpoPushTokenAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
};

jest.mock('expo', () => ({
  isRunningInExpoGo: () => mockExpoGo,
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    easConfig: null,
    expoConfig: { extra: { eas: { projectId: 'project-id' } } },
  },
}));
jest.mock('expo-notifications', () => mockNotifications);
jest.mock('@/shared/api/request', () => ({
  ...jest.requireActual('@/shared/api/request'),
  request: jest.fn(),
}));

const mockedRequest = jest.mocked(request);
const register = (onProgress?: (stage: 'permission' | 'token' | 'api') => void) =>
  registerPushDevice(onProgress, { notificationsModule: mockNotifications as never });

describe('push notification registration', () => {
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    mockExpoGo = false;
    jest.clearAllMocks();
    mockNotifications.setNotificationChannelAsync.mockResolvedValue(undefined);
    mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockNotifications.getExpoPushTokenAsync.mockResolvedValue({
      data: 'ExponentPushToken[abcdefghijklmnopqrstuvwxyz]',
    });
    mockedRequest.mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000001',
      platform: 'android',
      enabled: true,
      updatedAt: '2026-09-06T00:00:00.000Z',
    } as never);
  });

  it('skips the native notification module in Expo Go', async () => {
    mockExpoGo = true;

    expect(canUseRemotePush()).toBe(false);
    await expect(registerPushDevice()).resolves.toEqual({
      status: 'unsupported',
      reason: 'runtime',
    });
    expect(mockNotifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns a permission-specific result when the user denies notifications', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(register()).resolves.toEqual({
      status: 'permission_denied',
      reason: 'permission',
    });
    expect(mockNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('creates the Android channel before fetching a token and registers the device', async () => {
    const progress: string[] = [];

    await expect(register((stage) => progress.push(stage))).resolves.toEqual({
      status: 'registered',
      deviceId: '10000000-0000-4000-8000-000000000001',
      platform: 'android',
    });

    expect(progress).toEqual(['permission', 'token', 'api']);
    expect(mockNotifications.setNotificationChannelAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mockNotifications.getExpoPushTokenAsync.mock.invocationCallOrder[0],
    );
    expect(mockedRequest).toHaveBeenCalledWith(
      '/api/push-devices',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ locale: 'zh-CN' }),
      }),
    );
  });

  it('turns token failures into retryable errors without exposing the token', async () => {
    mockNotifications.getExpoPushTokenAsync.mockRejectedValue(
      new Error('failed for ExponentPushToken[super-secret-token]'),
    );

    const promise = register();
    await expect(promise).rejects.toMatchObject({
      code: 'EXPO_PUSH_TOKEN_FAILED',
      retryable: true,
    });
    await expect(promise).rejects.not.toThrow('super-secret-token');
    await expect(promise).rejects.toBeInstanceOf(PushRegistrationError);
  });

  it('preserves API timeout diagnostics for the registration status page', async () => {
    mockedRequest.mockRejectedValue(
      new WorkspaceRequestError('TIMEOUT', '请求超时，请重试。', true),
    );

    await expect(register()).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: '请求超时，请重试。',
      retryable: true,
    });
  });
});
