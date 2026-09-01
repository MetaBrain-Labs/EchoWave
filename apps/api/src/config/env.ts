/**
 * API 环境配置组合入口。
 *
 * 从唯一的 `.env` 文件加载配置，组合各领域配置模块并输出兼容的 ApiConfig。
 *
 * Responsibilities:
 * - 一次性校验完整环境变量集合。
 * - 组合 HTTP、数据库、Redis、供应商、工作区和执行报告配置。
 * - 为缺失配置文件提供明确启动错误。
 *
 * Notes:
 * - 不合并系统环境变量，也不提供隐式默认值。
 */
import { readFileSync } from 'node:fs';

import { parse } from 'dotenv';

import {
  AiExecutionEnvironmentSchema,
  createAiExecutionReportConfig,
  type AiExecutionReportConfig,
} from './aiExecution.ts';
import {
  createDatabaseConfig,
  DatabaseEnvironmentSchema,
  type DatabaseConfig,
} from './database.ts';
import { createHttpConfig, HttpEnvironmentSchema, type HttpConfig } from './http.ts';
import {
  createProviderConfig,
  ProviderEnvironmentSchema,
  type ProviderConfig,
} from './providers.ts';
import { createRedisConfig, RedisEnvironmentSchema, type RedisConfig } from './redis.ts';
import {
  createSettingsSecurityConfig,
  SettingsSecurityEnvironmentSchema,
  type SettingsSecurityConfig,
} from './settings.ts';
import { createRagConfig, type RagConfig, WorkspaceEnvironmentSchema } from './workspace.ts';

const EnvironmentSchema = HttpEnvironmentSchema.merge(DatabaseEnvironmentSchema)
  .merge(RedisEnvironmentSchema)
  .merge(ProviderEnvironmentSchema)
  .merge(WorkspaceEnvironmentSchema)
  .merge(SettingsSecurityEnvironmentSchema)
  .merge(AiExecutionEnvironmentSchema);

/** API 进程通过校验后可使用的完整运行时配置。 */
export type ApiConfig = HttpConfig & {
  database: DatabaseConfig;
  redis: RedisConfig;
  settingsSecurity: SettingsSecurityConfig;
  rag: RagConfig;
  aiExecutionReports: AiExecutionReportConfig;
  legacyProviders: ProviderConfig['legacy'];
};

/** 将显式键值集合解析为无默认值的强类型 API 配置。 */
export function readApiConfig(values: Record<string, string | undefined>): ApiConfig {
  const parsed = EnvironmentSchema.parse(values);
  const http = createHttpConfig(parsed);
  const providers = createProviderConfig(parsed);
  return {
    ...http,
    database: createDatabaseConfig(parsed),
    redis: createRedisConfig(parsed),
    settingsSecurity: createSettingsSecurityConfig(parsed),
    rag: createRagConfig(parsed, providers),
    legacyProviders: providers.legacy,
    aiExecutionReports: createAiExecutionReportConfig(parsed),
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
