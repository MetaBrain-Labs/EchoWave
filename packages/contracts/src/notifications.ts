/**
 * 移动推送设备网络契约。
 *
 * 定义固定租户里 Expo Push Token 的登记和停用接口，不把通知载荷当作任务状态来源。
 *
 * Responsibilities:
 * - 校验 Expo Token、平台和设备登记响应。
 *
 * Notes:
 * - 首版没有用户账号归属，设备仅按当前租户隔离。
 */
import { z } from 'zod';

import { EntityIdSchema, SupportedLanguageSchema } from './common.ts';

export const ExpoPushTokenSchema = z.string().regex(/^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/);

export const PushDeviceRegisterRequestSchema = z
  .object({
    token: ExpoPushTokenSchema,
    platform: z.enum(['ios', 'android']),
    locale: SupportedLanguageSchema.default('zh-CN'),
  })
  .strict();

export const PushDeviceDeleteRequestSchema = z.object({ token: ExpoPushTokenSchema }).strict();

export const PushDeviceSchema = z
  .object({
    id: EntityIdSchema,
    platform: z.enum(['ios', 'android']),
    locale: SupportedLanguageSchema.default('zh-CN'),
    enabled: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type PushDeviceRegisterRequest = z.infer<typeof PushDeviceRegisterRequestSchema>;
export type PushDevice = z.infer<typeof PushDeviceSchema>;
