/**
 * EchoWave 服务健康契约。
 *
 * 定义客户端连接自托管服务时使用的身份、兼容版本与能力声明。
 *
 * Responsibilities:
 * - 校验公开健康端点的稳定响应结构。
 * - 暴露客户端可安全用于功能门禁的非敏感能力标记。
 *
 * Notes:
 * - 健康响应不得包含主机配置、凭据或内部依赖错误。
 */
import { z } from 'zod';

/** 客户端当前支持的 EchoWave HTTP API 主版本。 */
export const ECHOWAVE_API_VERSION = 1 as const;

/** EchoWave 服务能力声明。 */
export const HealthCapabilitiesSchema = z.object({
  remotePush: z.boolean(),
});

/** 自托管连接探测成功响应。 */
export const HealthResponseSchema = z.object({
  name: z.literal('EchoWave'),
  service: z.literal('echowave-api'),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  apiVersion: z.literal(ECHOWAVE_API_VERSION),
  status: z.literal('ok'),
  capabilities: HealthCapabilitiesSchema,
});

/** EchoWave 服务健康响应类型。 */
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
