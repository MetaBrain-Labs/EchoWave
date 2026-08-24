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
  OPENROUTER_API_KEY: z.string().min(1),
  RAG_EMBEDDING_MODEL: z.literal('qwen/qwen3-embedding-8b'),
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
  AUDIO_TRANSCRIPTION_MODEL: z.literal('google/gemini-2.5-flash-lite'),
  AUDIO_TRANSCRIPTION_TEMP_DIR: z.string().min(1),
  FFMPEG_PATH: OptionalPathSchema,
  AI_EXECUTION_REPORT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_OUTPUT_DIR: z.string().min(1),
  AI_EXECUTION_REPORT_CONTEXT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_OUTPUT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_REASONING_ENABLED: BooleanStringSchema,
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
    openRouterApiKey: string;
    embeddingModel: 'qwen/qwen3-embedding-8b';
    embeddingDimensions: 1024;
    deepSeekApiKey: string;
    deepSeekBaseUrl: string;
    deepSeekChatModel: 'deepseek-v4-flash';
    enableThinking: boolean;
    langGraphSchema: string;
    uploadTempDir: string;
    audioStorageDir: string;
    audioTranscriptionModel: 'google/gemini-2.5-flash-lite';
    audioTranscriptionTempDir: string;
    ffmpegPath?: string;
  };
  aiExecutionReports: {
    enabled: boolean;
    outputDirectory: string;
    includeContext: boolean;
    includeToolContent: boolean;
    includeOutput: boolean;
    includeReasoning: boolean;
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
      openRouterApiKey: parsed.OPENROUTER_API_KEY,
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
      audioTranscriptionTempDir: parsed.AUDIO_TRANSCRIPTION_TEMP_DIR,
      ffmpegPath: parsed.FFMPEG_PATH,
    },
    aiExecutionReports: {
      enabled: parsed.AI_EXECUTION_REPORT_ENABLED,
      outputDirectory: parsed.AI_EXECUTION_REPORT_OUTPUT_DIR,
      includeContext: parsed.AI_EXECUTION_REPORT_CONTEXT_ENABLED,
      includeToolContent: parsed.AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED,
      includeOutput: parsed.AI_EXECUTION_REPORT_OUTPUT_ENABLED,
      includeReasoning: parsed.AI_EXECUTION_REPORT_REASONING_ENABLED,
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
