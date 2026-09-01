/**
 * AI 供应商配置。
 *
 * 管理 DashScope、OSS、EventBridge 与 DeepSeek 的配置校验和规范化，不包含领域模型选择。
 *
 * Responsibilities:
 * - 校验供应商端点与凭据。
 * - 保证 OSS 和 EventBridge 成组配置满足当前通知模式。
 *
 * Notes:
 * - 凭据只存在于服务端配置对象，不得进入客户端或诊断日志。
 */
import { z } from 'zod';

import { BooleanStringSchema, OptionalStringSchema } from './schema.ts';

export const ProviderEnvironmentSchema = z.object({
  DASHSCOPE_API_KEY: OptionalStringSchema,
  DASHSCOPE_BASE_URL: OptionalStringSchema,
  DASHSCOPE_COMPATIBLE_BASE_URL: OptionalStringSchema,
  DASHSCOPE_ASYNC_NOTIFY_MODE: z.enum(['polling', 'eventbridge']).optional(),
  DASHSCOPE_EVENTBRIDGE_CALLBACK_URL: OptionalStringSchema,
  DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN: OptionalStringSchema,
  ALIYUN_OSS_REGION: OptionalStringSchema,
  ALIYUN_OSS_BUCKET: OptionalStringSchema,
  ALIYUN_OSS_ACCESS_KEY_ID: OptionalStringSchema,
  ALIYUN_OSS_ACCESS_KEY_SECRET: OptionalStringSchema,
  DEEPSEEK_API_KEY: OptionalStringSchema,
  DEEPSEEK_BASE_URL: OptionalStringSchema,
  DEEPSEEK_CHAT_MODEL: z.literal('deepseek-v4-flash').optional(),
  DEEPSEEK_ENABLE_THINKING: BooleanStringSchema.optional(),
});

export type ProviderConfig = {
  dashScope: {
    apiKey: string;
    baseUrl: string;
    compatibleBaseUrl: string;
    asyncNotifyMode: 'polling' | 'eventbridge';
    eventBridgeCallback?: { url: string; token: string };
    oss?: { region: string; bucket: string; accessKeyId: string; accessKeySecret: string };
  };
  deepSeek: {
    apiKey: string;
    baseUrl: string;
    chatModel: 'deepseek-v4-flash';
    enableThinking: boolean;
  };
  legacy: {
    detectedVariables: string[];
    missingVariables: string[];
    dashScope?: ProviderConfig['dashScope'];
    deepSeek?: ProviderConfig['deepSeek'];
  };
};

/** 校验供应商跨字段约束并生成规范化配置。 */
export function createProviderConfig(
  values: z.infer<typeof ProviderEnvironmentSchema>,
): ProviderConfig {
  const detectedVariables = Object.entries(values)
    .filter(
      ([key, value]) =>
        (key.startsWith('DASHSCOPE_') ||
          key.startsWith('DEEPSEEK_') ||
          key.startsWith('ALIYUN_OSS_')) &&
        value !== undefined,
    )
    .map(([key]) => key);
  const requiredLegacyVariables = [
    'DASHSCOPE_API_KEY',
    'DASHSCOPE_BASE_URL',
    'DASHSCOPE_COMPATIBLE_BASE_URL',
    'DASHSCOPE_ASYNC_NOTIFY_MODE',
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_BASE_URL',
    'DEEPSEEK_CHAT_MODEL',
    'DEEPSEEK_ENABLE_THINKING',
  ] as const;
  const missingVariables: string[] = requiredLegacyVariables.filter(
    (key) => values[key] === undefined,
  );
  for (const value of [
    values.DASHSCOPE_BASE_URL,
    values.DASHSCOPE_COMPATIBLE_BASE_URL,
    values.DEEPSEEK_BASE_URL,
  ]) {
    if (value) new URL(value);
  }
  const ossValues = [
    values.ALIYUN_OSS_REGION,
    values.ALIYUN_OSS_BUCKET,
    values.ALIYUN_OSS_ACCESS_KEY_ID,
    values.ALIYUN_OSS_ACCESS_KEY_SECRET,
  ];
  const configuredOssValues = ossValues.filter(Boolean).length;
  if (configuredOssValues > 0 && configuredOssValues !== ossValues.length) {
    for (const key of [
      'ALIYUN_OSS_REGION',
      'ALIYUN_OSS_BUCKET',
      'ALIYUN_OSS_ACCESS_KEY_ID',
      'ALIYUN_OSS_ACCESS_KEY_SECRET',
    ]) {
      if (!values[key as keyof typeof values]) missingVariables.push(key);
    }
  }

  const callbackValues = [
    values.DASHSCOPE_EVENTBRIDGE_CALLBACK_URL,
    values.DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN,
  ];
  const configuredCallbackValues = callbackValues.filter(Boolean).length;
  if (values.DASHSCOPE_ASYNC_NOTIFY_MODE === 'polling' && configuredCallbackValues > 0) {
    throw new Error('Polling mode must not configure EventBridge callback URL or token.');
  }
  if (
    values.DASHSCOPE_ASYNC_NOTIFY_MODE === 'eventbridge' &&
    configuredCallbackValues !== callbackValues.length
  ) {
    if (!values.DASHSCOPE_EVENTBRIDGE_CALLBACK_URL) {
      missingVariables.push('DASHSCOPE_EVENTBRIDGE_CALLBACK_URL');
    }
    if (!values.DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN) {
      missingVariables.push('DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN');
    }
  }

  let eventBridgeCallback: { url: string; token: string } | undefined;
  if (
    values.DASHSCOPE_ASYNC_NOTIFY_MODE === 'eventbridge' &&
    values.DASHSCOPE_EVENTBRIDGE_CALLBACK_URL &&
    values.DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN
  ) {
    const callbackUrl = new URL(values.DASHSCOPE_EVENTBRIDGE_CALLBACK_URL!);
    if (
      !['http:', 'https:'].includes(callbackUrl.protocol) ||
      callbackUrl.hash ||
      callbackUrl.pathname !== '/api/webhooks/dashscope/async-task-finished'
    ) {
      throw new Error(
        'DASHSCOPE_EVENTBRIDGE_CALLBACK_URL must be an absolute HTTP(S) URL for /api/webhooks/dashscope/async-task-finished without a fragment.',
      );
    }
    eventBridgeCallback = {
      url: values.DASHSCOPE_EVENTBRIDGE_CALLBACK_URL!,
      token: values.DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN!,
    };
  }

  const oss =
    configuredOssValues === ossValues.length
      ? {
          region: values.ALIYUN_OSS_REGION!,
          bucket: values.ALIYUN_OSS_BUCKET!,
          accessKeyId: values.ALIYUN_OSS_ACCESS_KEY_ID!,
          accessKeySecret: values.ALIYUN_OSS_ACCESS_KEY_SECRET!,
        }
      : undefined;

  const dashScope = {
    apiKey: values.DASHSCOPE_API_KEY ?? '',
    baseUrl: (values.DASHSCOPE_BASE_URL ?? 'https://dashscope.invalid').replace(/\/$/, ''),
    compatibleBaseUrl: (
      values.DASHSCOPE_COMPATIBLE_BASE_URL ?? 'https://dashscope.invalid'
    ).replace(/\/$/, ''),
    asyncNotifyMode: values.DASHSCOPE_ASYNC_NOTIFY_MODE ?? ('polling' as const),
    ...(eventBridgeCallback ? { eventBridgeCallback } : {}),
    ...(oss ? { oss } : {}),
  };
  const deepSeek = {
    apiKey: values.DEEPSEEK_API_KEY ?? '',
    baseUrl: (values.DEEPSEEK_BASE_URL ?? 'https://deepseek.invalid').replace(/\/$/, ''),
    chatModel: values.DEEPSEEK_CHAT_MODEL ?? ('deepseek-v4-flash' as const),
    enableThinking: values.DEEPSEEK_ENABLE_THINKING ?? false,
  };
  return {
    dashScope,
    deepSeek,
    legacy: {
      detectedVariables,
      missingVariables: [...new Set(missingVariables)],
      ...(missingVariables.some((key) => key.startsWith('DASHSCOPE_')) ? {} : { dashScope }),
      ...(missingVariables.some((key) => key.startsWith('DEEPSEEK_')) ? {} : { deepSeek }),
    },
  };
}
