/**
 * 环境变量基础 Schema。
 *
 * 集中定义多个配置模块共享的字符串规范化规则，不负责读取配置来源或组合业务配置。
 *
 * Responsibilities:
 * - 提供严格布尔字符串解析。
 * - 提供可选路径和可选凭据字符串的统一空白处理。
 *
 * Notes:
 * - 这些 Schema 不提供默认值。
 */
import { z } from 'zod';

/** 将显式 true/false 字符串转换为布尔值。 */
export const BooleanStringSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

/** 将缺失或纯空白字符串规范化为 undefined。 */
export const OptionalStringSchema = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);
