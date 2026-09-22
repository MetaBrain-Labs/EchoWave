/**
 * 知识检索租户设置网络契约。
 *
 * 定义智能重排的公开只读状态与管理员乐观锁更新输入。
 *
 * Responsibilities:
 * - 保证服务端是重排开关的唯一权威来源。
 * - 暴露不含 Credential 的模型配置就绪状态。
 *
 * Notes:
 * - 客户端问答请求不能覆盖该租户级设置。
 */
import { z } from 'zod';

/** 当前租户的知识检索设置。 */
export const KnowledgeRetrievalSettingsSchema = z
  .object({
    rerankEnabled: z.boolean(),
    rerankerModel: z.literal('qwen3.7-text-rerank'),
    rerankerConfigured: z.boolean(),
    revision: z.number().int().positive(),
  })
  .strict();

/** 管理员更新知识检索设置时的严格乐观锁输入。 */
export const KnowledgeRetrievalSettingsUpdateRequestSchema = z
  .object({
    rerankEnabled: z.boolean(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export type KnowledgeRetrievalSettings = z.infer<typeof KnowledgeRetrievalSettingsSchema>;
export type KnowledgeRetrievalSettingsUpdateRequest = z.infer<
  typeof KnowledgeRetrievalSettingsUpdateRequestSchema
>;
