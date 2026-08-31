/**
 * Redis 预留配置。
 *
 * 保留未来缓存、协调或队列集成所需的显式配置契约，当前不创建 Redis 客户端。
 *
 * Responsibilities:
 * - 校验 Redis 连接字段。
 * - 映射 TLS 与数据库编号。
 *
 * Notes:
 * - Redis 不得成为业务数据的第二权威来源。
 */
import { z } from 'zod';

import { BooleanStringSchema } from './schema.ts';

export const RedisEnvironmentSchema = z.object({
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535),
  REDIS_PASSWORD: z.string(),
  REDIS_USERNAME: z.string(),
  REDIS_DB: z.coerce.number().int().min(0),
  REDIS_TLS: BooleanStringSchema,
});

export type RedisConfig = {
  host: string;
  port: number;
  password: string;
  username: string;
  database: number;
  tls: boolean;
};

/** 将 Redis 环境变量映射为预留运行时配置。 */
export function createRedisConfig(values: z.infer<typeof RedisEnvironmentSchema>): RedisConfig {
  return {
    host: values.REDIS_HOST,
    port: values.REDIS_PORT,
    password: values.REDIS_PASSWORD,
    username: values.REDIS_USERNAME,
    database: values.REDIS_DB,
    tls: values.REDIS_TLS,
  };
}
