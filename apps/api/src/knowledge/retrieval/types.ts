/**
 * 知识检索领域类型。
 *
 * 定义回答、业务分析和持久化实现之间共享的安全检索结果，不绑定具体 Repository。
 *
 * Responsibilities:
 * - 描述可引用的租户范围知识块。
 *
 * Notes:
 * - 类型不包含数据库行或 SQL 实现细节。
 */
import type { SourceLocator } from '@echowave/contracts';

/** 向知识消费用例返回的可引用检索结果。 */
export type RetrievalChunk = {
  id: string;
  knowledgeBaseId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  locator: SourceLocator;
  distance: number;
};
