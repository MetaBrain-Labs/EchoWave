/**
 * API 配置模块。
 *
 * 从唯一的 `.env` 来源读取并校验 HTTP、PostgreSQL、Redis、RAG 与 AI 诊断配置，
 * 阻止无效配置进入运行时组合根。
 *
 * Responsibilities:
 * - 定义并验证完整环境变量契约。
 * - 将字符串配置规范化为强类型运行时对象。
 * - 为缺失配置文件提供可操作的启动错误。
 *
 * Notes:
 * - 不合并系统环境变量，也不提供隐式默认值。
 */
import { readFileSync } from 'node:fs';

import { parse } from 'dotenv';
import { z } from 'zod';
import { AudioTranscriptionModelSchema, type AudioTranscriptionModel } from '@echowave/contracts';

const BooleanStringSchema = z.enum(['true', 'false']).transform((value) => value === 'true');
const OptionalPathSchema = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const EnvironmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535),
  CORS_ORIGINS: z.string().min(1),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65_535),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_SCHEMA: z.string().min(1),
  POSTGRES_SSL: BooleanStringSchema,
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535),
  REDIS_PASSWORD: z.string(),
  REDIS_USERNAME: z.string(),
  REDIS_DB: z.coerce.number().int().min(0),
  REDIS_TLS: BooleanStringSchema,
  DEV_TENANT_ID: z.string().uuid(),
  DASHSCOPE_API_KEY: z.string().min(1),
  DASHSCOPE_BASE_URL: z.string().url(),
  DASHSCOPE_COMPATIBLE_BASE_URL: z.string().url(),
  DASHSCOPE_ASYNC_NOTIFY_MODE: z.enum(['polling', 'eventbridge']),
  DASHSCOPE_EVENTBRIDGE_CALLBACK_URL: OptionalPathSchema,
  DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN: OptionalPathSchema,
  ALIYUN_OSS_REGION: OptionalPathSchema,
  ALIYUN_OSS_BUCKET: OptionalPathSchema,
  ALIYUN_OSS_ACCESS_KEY_ID: OptionalPathSchema,
  ALIYUN_OSS_ACCESS_KEY_SECRET: OptionalPathSchema,
  RAG_EMBEDDING_MODEL: z.literal('qwen3.7-text-embedding'),
  RAG_EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .refine((value) => value === 1024),
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_BASE_URL: z.string().url(),
  DEEPSEEK_CHAT_MODEL: z.literal('deepseek-v4-flash'),
  DEEPSEEK_ENABLE_THINKING: BooleanStringSchema,
  LANGGRAPH_SCHEMA: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  UPLOAD_TEMP_DIR: z.string().min(1),
  AUDIO_STORAGE_DIR: z.string().min(1),
  AUDIO_TRANSCRIPTION_MODEL: AudioTranscriptionModelSchema,
  AUDIO_EMOTION_MODEL: z.literal('qwen3.5-omni-flash'),
  AUDIO_TRANSCRIPTION_TEMP_DIR: z.string().min(1),
  AUDIO_TRANSCRIPTION_MAX_IN_FLIGHT: z.coerce.number().int().min(1).max(100),
  FFMPEG_PATH: OptionalPathSchema,
  AI_EXECUTION_REPORT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_OUTPUT_DIR: z.string().min(1),
  AI_EXECUTION_REPORT_CONTEXT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_OUTPUT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_REASONING_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_STT_RAW_RESPONSE_ENABLED: BooleanStringSchema,
});

/** API 进程通过校验后可使用的完整运行时配置。 */
export type ApiConfig = {
  port: number;
  corsOrigins: string[];
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    schema: string;
    ssl: boolean;
  };
  redis: {
    host: string;
    port: number;
    password: string;
    username: string;
    database: number;
    tls: boolean;
  };
  rag: {
    tenantId: string;
    dashScope: {
      apiKey: string;
      baseUrl: string;
      compatibleBaseUrl: string;
      asyncNotifyMode: 'polling' | 'eventbridge';
      eventBridgeCallback?: {
        url: string;
        token: string;
      };
      oss?: {
        region: string;
        bucket: string;
        accessKeyId: string;
        accessKeySecret: string;
      };
    };
    embeddingModel: 'qwen3.7-text-embedding';
    embeddingDimensions: 1024;
    deepSeekApiKey: string;
    deepSeekBaseUrl: string;
    deepSeekChatModel: 'deepseek-v4-flash';
    enableThinking: boolean;
    langGraphSchema: string;
    uploadTempDir: string;
    audioStorageDir: string;
    audioTranscriptionModel: AudioTranscriptionModel;
    audioEmotionModel: 'qwen3.5-omni-flash';
    audioTranscriptionTempDir: string;
    audioTranscriptionMaxInFlight: number;
    ffmpegPath?: string;
  };
  aiExecutionReports: {
    enabled: boolean;
    outputDirectory: string;
    includeContext: boolean;
    includeToolContent: boolean;
    includeOutput: boolean;
    includeReasoning: boolean;
    includeSttRawResponses: boolean;
  };
};

/** 将显式键值集合解析为无默认值的强类型 API 配置。 */
export function readApiConfig(values: Record<string, string | undefined>): ApiConfig {
  const parsed = EnvironmentSchema.parse(values);
  const corsOrigins = parsed.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin.');
  }

  const ossValues = [
    parsed.ALIYUN_OSS_REGION,
    parsed.ALIYUN_OSS_BUCKET,
    parsed.ALIYUN_OSS_ACCESS_KEY_ID,
    parsed.ALIYUN_OSS_ACCESS_KEY_SECRET,
  ];
  const configuredOssValues = ossValues.filter(Boolean).length;
  if (configuredOssValues > 0 && configuredOssValues !== ossValues.length) {
    throw new Error(
      'OSS configuration must include ALIYUN_OSS_REGION, ALIYUN_OSS_BUCKET, ALIYUN_OSS_ACCESS_KEY_ID and ALIYUN_OSS_ACCESS_KEY_SECRET together.',
    );
  }
  const callbackValues = [
    parsed.DASHSCOPE_EVENTBRIDGE_CALLBACK_URL,
    parsed.DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN,
  ];
  const configuredCallbackValues = callbackValues.filter(Boolean).length;
  if (parsed.DASHSCOPE_ASYNC_NOTIFY_MODE === 'polling' && configuredCallbackValues > 0) {
    throw new Error('Polling mode must not configure EventBridge callback URL or token.');
  }
  if (
    parsed.DASHSCOPE_ASYNC_NOTIFY_MODE === 'eventbridge' &&
    configuredCallbackValues !== callbackValues.length
  ) {
    throw new Error('EventBridge mode requires callback URL and token together.');
  }
  let eventBridgeCallback: { url: string; token: string } | undefined;
  if (parsed.DASHSCOPE_ASYNC_NOTIFY_MODE === 'eventbridge') {
    const callbackUrl = new URL(parsed.DASHSCOPE_EVENTBRIDGE_CALLBACK_URL!);
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
      url: parsed.DASHSCOPE_EVENTBRIDGE_CALLBACK_URL!,
      token: parsed.DASHSCOPE_EVENTBRIDGE_CALLBACK_TOKEN!,
    };
  }
  const oss =
    configuredOssValues === ossValues.length
      ? {
          region: parsed.ALIYUN_OSS_REGION!,
          bucket: parsed.ALIYUN_OSS_BUCKET!,
          accessKeyId: parsed.ALIYUN_OSS_ACCESS_KEY_ID!,
          accessKeySecret: parsed.ALIYUN_OSS_ACCESS_KEY_SECRET!,
        }
      : undefined;

  return {
    port: parsed.PORT,
    corsOrigins,
    database: {
      host: parsed.POSTGRES_HOST,
      port: parsed.POSTGRES_PORT,
      user: parsed.POSTGRES_USER,
      password: parsed.POSTGRES_PASSWORD,
      database: parsed.POSTGRES_DB,
      schema: parsed.POSTGRES_SCHEMA,
      ssl: parsed.POSTGRES_SSL,
    },
    redis: {
      host: parsed.REDIS_HOST,
      port: parsed.REDIS_PORT,
      password: parsed.REDIS_PASSWORD,
      username: parsed.REDIS_USERNAME,
      database: parsed.REDIS_DB,
      tls: parsed.REDIS_TLS,
    },
    rag: {
      tenantId: parsed.DEV_TENANT_ID,
      dashScope: {
        apiKey: parsed.DASHSCOPE_API_KEY,
        baseUrl: parsed.DASHSCOPE_BASE_URL.replace(/\/$/, ''),
        compatibleBaseUrl: parsed.DASHSCOPE_COMPATIBLE_BASE_URL.replace(/\/$/, ''),
        asyncNotifyMode: parsed.DASHSCOPE_ASYNC_NOTIFY_MODE,
        ...(eventBridgeCallback ? { eventBridgeCallback } : {}),
        ...(oss ? { oss } : {}),
      },
      embeddingModel: parsed.RAG_EMBEDDING_MODEL,
      embeddingDimensions: parsed.RAG_EMBEDDING_DIMENSIONS,
      deepSeekApiKey: parsed.DEEPSEEK_API_KEY,
      deepSeekBaseUrl: parsed.DEEPSEEK_BASE_URL.replace(/\/$/, ''),
      deepSeekChatModel: parsed.DEEPSEEK_CHAT_MODEL,
      enableThinking: parsed.DEEPSEEK_ENABLE_THINKING,
      langGraphSchema: parsed.LANGGRAPH_SCHEMA,
      uploadTempDir: parsed.UPLOAD_TEMP_DIR,
      audioStorageDir: parsed.AUDIO_STORAGE_DIR,
      audioTranscriptionModel: parsed.AUDIO_TRANSCRIPTION_MODEL,
      audioEmotionModel: parsed.AUDIO_EMOTION_MODEL,
      audioTranscriptionTempDir: parsed.AUDIO_TRANSCRIPTION_TEMP_DIR,
      audioTranscriptionMaxInFlight: parsed.AUDIO_TRANSCRIPTION_MAX_IN_FLIGHT,
      ffmpegPath: parsed.FFMPEG_PATH,
    },
    aiExecutionReports: {
      enabled: parsed.AI_EXECUTION_REPORT_ENABLED,
      outputDirectory: parsed.AI_EXECUTION_REPORT_OUTPUT_DIR,
      includeContext: parsed.AI_EXECUTION_REPORT_CONTEXT_ENABLED,
      includeToolContent: parsed.AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED,
      includeOutput: parsed.AI_EXECUTION_REPORT_OUTPUT_ENABLED,
      includeReasoning: parsed.AI_EXECUTION_REPORT_REASONING_ENABLED,
      includeSttRawResponses: parsed.AI_EXECUTION_REPORT_STT_RAW_RESPONSE_ENABLED,
    },
  };
}

/** 仅从指定 `.env` 文件加载所需配置，并为文件缺失提供明确错误。 */
export function readApiConfigFile(fileUrl: URL): ApiConfig {
  try {
    return readApiConfig(parse(readFileSync(fileUrl)));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Required API configuration file was not found: ${fileUrl.pathname}`, {
        cause: error,
      });
    }
    throw error;
  }
}
