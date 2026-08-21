/**
 * 知识库网络契约。
 *
 * 定义知识库创建、更新、列表和详情使用的运行时结构。
 *
 * Responsibilities:
 * - 校验知识库用户输入。
 * - 统一知识库摘要与详情负载。
 *
 * Notes:
 * - 文档与可信问答契约位于相邻领域文件。
 */
import { z } from 'zod';

import { EntityIdSchema } from './common.ts';

/** 创建知识库所需的用户输入 schema。 */
export const KnowledgeBaseCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_000).default(''),
});

/** 更新知识库的部分字段输入 schema，至少要求一个字段。 */
export const KnowledgeBaseUpdateRequestSchema = KnowledgeBaseCreateRequestSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be provided.' },
);

/** 知识库列表和详情共用的摘要 schema。 */
export const KnowledgeBaseSummarySchema = z.object({
  id: EntityIdSchema,
  name: z.string(),
  description: z.string(),
  documentCount: z.number().int().nonnegative(),
  linkedGroupCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export const KnowledgeBaseListResponseSchema = z.object({ items: z.array(KnowledgeBaseSummarySchema) });
export const KnowledgeBaseDetailSchema = KnowledgeBaseSummarySchema;

/** 创建知识库输入类型。 */
export type KnowledgeBaseCreateRequest = z.infer<typeof KnowledgeBaseCreateRequestSchema>;
/** 知识库详情类型。 */
export type KnowledgeBaseDetail = z.infer<typeof KnowledgeBaseDetailSchema>;
/** 知识库摘要类型。 */
export type KnowledgeBaseSummary = z.infer<typeof KnowledgeBaseSummarySchema>;
