/**
 * API 运行日志配置。
 *
 * 负责日志级别与输出格式的环境变量校验与运行时映射。
 *
 * Responsibilities:
 * - 校验 LOG_LEVEL 与 LOG_FORMAT。
 * - 生成 infrastructure 日志核心使用的 LoggingConfig。
 *
 * Notes:
 * - 两个字段都提供显式默认值，因此既有 .env 无需新增变量即可启动。
 * - 日志行为只由这两个变量决定，不依赖 NODE_ENV。
 */
import { z } from 'zod';

export const LoggingEnvironmentSchema = z.object({
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
});

export type LoggingConfig = {
  level: z.infer<typeof LoggingEnvironmentSchema>['LOG_LEVEL'];
  format: z.infer<typeof LoggingEnvironmentSchema>['LOG_FORMAT'];
};

/** 将日志环境变量映射为运行时配置。 */
export function createLoggingConfig(
  values: z.infer<typeof LoggingEnvironmentSchema>,
): LoggingConfig {
  return { level: values.LOG_LEVEL, format: values.LOG_FORMAT };
}
