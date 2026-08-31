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
  DASHSCOPE_API_KEY: z.string().min(1),
  DASHSCOPE_BASE_URL: z.string().url(),
  DASHSCOPE_COMPATIBLE_BASE_URL: z.string().url(),
  DASHSCOPE_ASYNC_NOTIFY_MODE: z.enum(['polling', 'eventbridge']),
  DASHSCOPE_EVENTBRIDGE_CALLBACK_URL: OptionalStringSchema,
  DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN: OptionalStringSchema,
  ALIYUN_OSS_REGION: OptionalStringSchema,
  ALIYUN_OSS_BUCKET: OptionalStringSchema,
  ALIYUN_OSS_ACCESS_KEY_ID: OptionalStringSchema,
  ALIYUN_OSS_ACCESS_KEY_SECRET: OptionalStringSchema,
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_BASE_URL: z.string().url(),
  DEEPSEEK_CHAT_MODEL: z.literal('deepseek-v4-flash'),
  DEEPSEEK_ENABLE_THINKING: BooleanStringSchema,
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
};

/** 校验供应商跨字段约束并生成规范化配置。 */
export function createProviderConfig(
  values: z.infer<typeof ProviderEnvironmentSchema>,
): ProviderConfig {
  const ossValues = [
    values.ALIYUN_OSS_REGION,
    values.ALIYUN_OSS_BUCKET,
    values.ALIYUN_OSS_ACCESS_KEY_ID,
    values.ALIYUN_OSS_ACCESS_KEY_SECRET,
  ];
  const configuredOssValues = ossValues.filter(Boolean).length;
  if (configuredOssValues > 0 && configuredOssValues !== ossValues.length) {
    throw new Error(
      'OSS configuration must include ALIYUN_OSS_REGION, ALIYUN_OSS_BUCKET, ALIYUN_OSS_ACCESS_KEY_ID and ALIYUN_OSS_ACCESS_KEY_SECRET together.',
    );
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
    throw new Error('EventBridge mode requires callback URL and token together.');
  }

  let eventBridgeCallback: { url: string; token: string } | undefined;
  if (values.DASHSCOPE_ASYNC_NOTIFY_MODE === 'eventbridge') {
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

  return {
    dashScope: {
      apiKey: values.DASHSCOPE_API_KEY,
      baseUrl: values.DASHSCOPE_BASE_URL.replace(/\/$/, ''),
      compatibleBaseUrl: values.DASHSCOPE_COMPATIBLE_BASE_URL.replace(/\/$/, ''),
      asyncNotifyMode: values.DASHSCOPE_ASYNC_NOTIFY_MODE,
      ...(eventBridgeCallback ? { eventBridgeCallback } : {}),
      ...(oss ? { oss } : {}),
    },
    deepSeek: {
      apiKey: values.DEEPSEEK_API_KEY,
      baseUrl: values.DEEPSEEK_BASE_URL.replace(/\/$/, ''),
      chatModel: values.DEEPSEEK_CHAT_MODEL,
      enableThinking: values.DEEPSEEK_ENABLE_THINKING,
    },
  };
}
