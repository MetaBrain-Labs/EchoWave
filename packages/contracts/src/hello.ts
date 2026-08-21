/**
 * HelloWorld 网络契约。
 *
 * 定义 API 健康纵切片的运行时响应结构，并为生产者和消费者导出同源 TypeScript 类型。
 *
 * Responsibilities:
 * - 校验固定服务标识与 HelloWorld 消息。
 *
 * Notes:
 * - 网络数据必须通过 schema 解析，不能仅使用类型断言。
 */
import { z } from 'zod';

/** API 健康端点成功响应的运行时 schema。 */
export const HelloResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('echowave-api'),
  message: z.literal('HelloWorld'),
});

/** API 健康端点成功响应类型。 */
export type HelloResponse = z.infer<typeof HelloResponseSchema>;
