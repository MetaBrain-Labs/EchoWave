/**
 * 可信知识问答网络契约。
 *
 * 定义问题、已验证引用、token 用量和最终非流式回答结构。
 *
 * Responsibilities:
 * - 校验可信问答请求与最终响应。
 * - 保持引用使用文档来源定位契约。
 *
 * Notes:
 * - 未验证的模型候选输出不属于网络契约。
 */
import { z } from 'zod';

import { EntityIdSchema } from './common.ts';
import { SourceLocatorSchema } from './document.ts';

/** 用户提交知识库问题的最终 JSON 请求 schema。 */
export const RagQueryRequestSchema = z.object({
  question: z.string().trim().min(1).max(2_000), conversationId: EntityIdSchema.optional(),
});
/** 可信回答中一个已验证引用的 schema。 */
export const RagCitationSchema = z.object({
  number: z.number().int().positive(), documentId: EntityIdSchema, documentTitle: z.string(),
  chunkId: EntityIdSchema, locator: SourceLocatorSchema, excerpt: z.string(),
});
/** 一次可信回答产生的 embedding 与模型 token 用量 schema。 */
export const RagUsageSchema = z.object({
  embeddingTokens: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
/** 服务端完成引用校验和审计后返回的可信回答 schema。 */
export const RagQueryResponseSchema = z.object({
  conversationId: EntityIdSchema, answer: z.string(), grounded: z.boolean(),
  citations: z.array(RagCitationSchema), usage: RagUsageSchema,
});

/** 可信问答请求类型。 */
export type RagQueryRequest = z.infer<typeof RagQueryRequestSchema>;
/** 可信问答最终响应类型。 */
export type RagQueryResponse = z.infer<typeof RagQueryResponseSchema>;
