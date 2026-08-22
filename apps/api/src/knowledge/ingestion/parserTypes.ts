/**
 * 知识文档解析类型。
 *
 * 定义格式解析器、分块器和 worker 共享的稳定结果与安全错误。
 *
 * Responsibilities:
 * - 统一语义段、文档块草稿与解析结果。
 *
 * Notes:
 * - 不包含格式专用依赖。
 */
import type { SourceLocator } from '@echowave/contracts';

/** 可安全传递到入库状态的文档解析错误。 */
export class DocumentParseError extends Error {
  constructor(
    public readonly code: 'DOCUMENT_TOO_LARGE' | 'INVALID_FILE' | 'UNSUPPORTED_FORMAT',
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'DocumentParseError';
  }
}

/** 尚未持久化、但已包含来源定位与 embedding 文本的文档块草稿。 */
export type ParsedChunkDraft = {
  index: number;
  title: string;
  headingPath: string[];
  content: string;
  embeddingText: string;
  contentSha256: string;
  locator: SourceLocator;
};

/** 一次文档解析产生的预览、文档块与非致命警告。 */
export type ParsedDocument = {
  chunks: ParsedChunkDraft[];
  previewText: string;
  warnings: string[];
};

/** 格式解析器返回给统一分块器的可追溯语义段。 */
export type SemanticSection = {
  title: string;
  headingPath: string[];
  content: string;
  locator: SourceLocator;
};
