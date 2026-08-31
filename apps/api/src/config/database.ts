/**
 * PostgreSQL 配置。
 *
 * 管理数据库连接所需的环境变量与强类型运行时配置，不创建连接池。
 *
 * Responsibilities:
 * - 校验 PostgreSQL 主机、端口、凭据、数据库和 schema。
 * - 映射 SSL 开关。
 *
 * Notes:
 * - PostgreSQL 仍是业务数据的唯一权威存储。
 */
import { z } from 'zod';

import { BooleanStringSchema } from './schema.ts';

export const DatabaseEnvironmentSchema = z.object({
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65_535),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_SCHEMA: z.string().min(1),
  POSTGRES_SSL: BooleanStringSchema,
});

export type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  schema: string;
  ssl: boolean;
};

/** 将 PostgreSQL 环境变量映射为连接配置。 */
export function createDatabaseConfig(
  values: z.infer<typeof DatabaseEnvironmentSchema>,
): DatabaseConfig {
  return {
    host: values.POSTGRES_HOST,
    port: values.POSTGRES_PORT,
    user: values.POSTGRES_USER,
    password: values.POSTGRES_PASSWORD,
    database: values.POSTGRES_DB,
    schema: values.POSTGRES_SCHEMA,
    ssl: values.POSTGRES_SSL,
  };
}
