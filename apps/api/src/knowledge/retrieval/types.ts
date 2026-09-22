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
import type {
  DocumentChunkContentKind,
  DocumentChunkTitleSource,
  SourceLocator,
} from '@echowave/contracts';

/** 向知识消费用例返回的可引用检索结果。 */
export type RetrievalChunk = {
  id: string;
  knowledgeBaseId: string;
  documentId: string;
  revisionId?: string;
  documentTitle: string;
  title: string;
  headingPath: string[];
  contentKind: DocumentChunkContentKind;
  titleSource: DocumentChunkTitleSource;
  partIndex: number;
  partCount: number;
  content: string;
  locator: SourceLocator;
  distance: number;
  rerankScore: number | null;
};

/** 一次检索的重排状态与安全审计摘要。 */
export type RetrievalAudit = {
  rerankStatus: 'applied' | 'disabled' | 'fallback';
  rerankerModel: string | null;
  rerankBindingRevisionId: string | null;
  candidateCount: number;
  finalChunkIds: string[];
  rerankTokens: number;
  rerankDurationMs: number;
  fallbackReason: string | null;
};

/** 带运行审计的检索结果。 */
export type KnowledgeSearchResult = { chunks: RetrievalChunk[]; audit: RetrievalAudit };
