/**
 * API HTTP 配置。
 *
 * 负责 HTTP 监听端口和跨域来源的环境变量校验与运行时映射。
 *
 * Responsibilities:
 * - 校验端口与 CORS 来源字符串。
 * - 生成 Hono 与服务器组合根使用的 HTTP 配置。
 *
 * Notes:
 * - 不读取文件，也不提供隐式默认来源。
 */
import { z } from 'zod';

export const HttpEnvironmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535),
  CORS_ORIGINS: z.string().min(1),
});

export type HttpConfig = {
  port: number;
  corsOrigins: string[];
};

/** 将 HTTP 环境变量映射为运行时配置。 */
export function createHttpConfig(values: z.infer<typeof HttpEnvironmentSchema>): HttpConfig {
  const corsOrigins = values.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin.');
  }
  return { port: values.PORT, corsOrigins };
}
