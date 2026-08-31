/**
 * 知识检索应用端口。
 *
 * 让问答和业务分析依赖检索能力而不是具体 PostgreSQL Repository。
 *
 * Responsibilities:
 * - 声明单知识库与多知识库向量检索接口。
 *
 * Notes:
 * - 租户、active revision 和结果上限由实现保证。
 */
import type { RetrievalChunk } from './types.ts';

/** 业务用例可依赖的知识检索能力。 */
export interface KnowledgeSearchPort {
  search(
    knowledgeBaseId: string,
    embedding: number[],
    embeddingModel: string,
  ): Promise<RetrievalChunk[]>;
  searchMany(
    knowledgeBaseIds: string[],
    embedding: number[],
    embeddingModel: string,
  ): Promise<RetrievalChunk[]>;
}
