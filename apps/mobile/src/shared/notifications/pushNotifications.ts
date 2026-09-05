/**
 * Expo 远程推送注册与分析批次深链。
 *
 * 原生 Development/Production Build 获取 Token 后登记到固定租户 API；权限拒绝、Web 或缺少 EAS
 * projectId 时静默降级为应用内 REST/SSE 状态。
 *
 * Responsibilities:
 * - 配置 Android 通知 Channel、请求权限并登记 Expo Push Token。
 * - 从前台、后台或冷启动通知中提取批次 ID。
 */
import {
  PushDeviceRegisterRequestSchema,
  PushDeviceSchema,
  type PushDeviceRegisterRequest,
} from '@echowave/contracts';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type * as Notifications from 'expo-notifications';

import { request } from '@/shared/api/request';

type NotificationsModule = typeof import('expo-notifications');

let notificationsModulePromise: Promise<NotificationsModule | null> | null = null;

/**
 * 判断当前运行时是否可以加载远程推送原生模块。
 *
 * Expo Go 的 Android 容器从 SDK 53 起不再包含远程推送实现；必须在调用任何
 * `expo-notifications` 运行时 API 之前拦截，否则模块初始化本身就会抛错并让
 * Expo Router 误报根布局缺少默认导出。
 */
export function canUseRemotePush(): boolean {
  return !isRunningInExpoGo() && (Platform.OS === 'ios' || Platform.OS === 'android');
}

/** 仅在原生 Build 中延迟加载通知模块，避免 Expo Go Android 初始化失败。 */
async function loadNotifications(): Promise<NotificationsModule | null> {
  if (!canUseRemotePush()) return null;
  notificationsModulePromise ??= import('expo-notifications');
  return notificationsModulePromise;
}

/** 配置前台通知展示策略；Expo Go 会安全跳过。 */
export function setupNotificationHandler(): void {
  void loadNotifications().then((Notifications) => {
    if (!Notifications) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  });
}

/** 在支持远程推送的原生构建中登记当前设备。 */
export async function registerPushDevice(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('analysis-alerts', {
      name: '分析任务通知',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  const permission =
    existing.status === 'granted' ? existing : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== 'string' || !projectId) return;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const input: PushDeviceRegisterRequest = {
    token: token.data,
    platform: Platform.OS,
  };
  await request('/api/push-devices', PushDeviceSchema, {
    method: 'POST',
    body: PushDeviceRegisterRequestSchema.parse(input),
  });
}

/**
 * 注册通知点击监听并提取批次深链。
 *
 * 返回同步清理函数，以便根布局卸载时不会留下异步加载完成后的监听器。
 */
export function subscribeToNotificationNavigation(
  onBatchOpen: (batchId: string) => void,
): () => void {
  let active = true;
  let subscription: Notifications.EventSubscription | null = null;

  void loadNotifications()
    .then(async (Notifications) => {
      if (!Notifications || !active) return;
      setupNotificationHandler();
      const open = (response: Notifications.NotificationResponse | null) => {
        if (!active || !response) return;
        const id = notificationBatchId(response);
        if (id) onBatchOpen(id);
      };
      subscription = Notifications.addNotificationResponseReceivedListener(open);
      await Notifications.getLastNotificationResponseAsync()
        .then(open)
        .catch(() => undefined);
    })
    .catch(() => undefined);

  return () => {
    active = false;
    subscription?.remove();
  };
}

/** 从最小通知数据中安全读取批次深链参数。 */
export function notificationBatchId(response: Notifications.NotificationResponse): string | null {
  const value = response.notification.request.content.data?.batchId;
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}
