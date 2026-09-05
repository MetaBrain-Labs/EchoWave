/**
 * Expo Push Service 能力与可选鉴权配置。
 *
 * Expo access token 未配置时使用服务默认匿名发送；配置后由服务端 SDK 附加访问令牌。
 *
 * Responsibilities:
 * - 显式控制当前部署是否允许远程推送。
 * - 校验可选 Expo Push access token。
 */
import { z } from 'zod';

export const NotificationEnvironmentSchema = z.object({
  PUSH_NOTIFICATIONS_ENABLED: z.enum(['true', 'false']),
  EXPO_PUSH_ACCESS_TOKEN: z.string().trim().min(1).optional(),
});

export type NotificationConfig = { enabled: boolean; expoPushAccessToken?: string };

/** 映射通知环境变量。 */
export function createNotificationConfig(
  values: z.infer<typeof NotificationEnvironmentSchema>,
): NotificationConfig {
  return {
    enabled: values.PUSH_NOTIFICATIONS_ENABLED === 'true',
    ...(values.EXPO_PUSH_ACCESS_TOKEN
      ? { expoPushAccessToken: values.EXPO_PUSH_ACCESS_TOKEN }
      : {}),
  };
}
