/**
 * Expo Push Service 可选鉴权配置。
 *
 * Expo access token 未配置时使用服务默认匿名发送；配置后由服务端 SDK 附加访问令牌。
 *
 * Responsibilities:
 * - 校验可选 Expo Push access token。
 */
import { z } from 'zod';

export const NotificationEnvironmentSchema = z.object({
  EXPO_PUSH_ACCESS_TOKEN: z.string().trim().min(1).optional(),
});

export type NotificationConfig = { expoPushAccessToken?: string };

/** 映射通知环境变量。 */
export function createNotificationConfig(
  values: z.infer<typeof NotificationEnvironmentSchema>,
): NotificationConfig {
  return values.EXPO_PUSH_ACCESS_TOKEN
    ? { expoPushAccessToken: values.EXPO_PUSH_ACCESS_TOKEN }
    : {};
}
