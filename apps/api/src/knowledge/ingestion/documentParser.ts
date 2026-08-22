/**
 * 知识文档解析入口。
 *
 * 按受支持格式选择解析器，并统一执行文本上限、分块、预览和警告归一化。
 *
 * Responsibilities:
 * - 向入库 worker 暴露单一解析接口。
 *
 * Notes:
 * - 不写数据库或调用 embedding 服务。
 */
import type { DocumentFormat } from '@echowave/contracts';

import { sha256, toChunks } from './chunking.ts';
import { DocumentParseError, type ParsedDocument } from './parserTypes.ts';
import { parseMarkdown } from './parsers/markdownParser.ts';
import { parseSpreadsheet } from './parsers/spreadsheetParser.ts';
import { parseWord } from './parsers/wordParser.ts';

export { DocumentParseError, type ParsedChunkDraft, type ParsedDocument } from './parserTypes.ts';

const MAX_EXTRACTED_CHARACTERS = 5_000_000;

/** 按文件格式解析并规范化知识文档，返回可追溯的文档块。 */
export async function parseKnowledgeDocument(
  buffer: Buffer,
  format: DocumentFormat,
  documentTitle: string,
): Promise<ParsedDocument> {
  const parsed =
    format === 'markdown'
      ? parseMarkdown(buffer)
      : format === 'word'
        ? await parseWord(buffer)
        : await parseSpreadsheet(buffer);
  const normalizedCharacters = parsed.sections.reduce(
    (total, section) => total + Array.from(section.content).length,
    0,
  );
  if (normalizedCharacters > MAX_EXTRACTED_CHARACTERS) {
    throw new DocumentParseError('DOCUMENT_TOO_LARGE', '解析后的文本超过 500 万字符。');
  }
  const chunks = toChunks(documentTitle, parsed.sections);
  if (chunks.length === 0) {
    throw new DocumentParseError('INVALID_FILE', '文件中没有可索引的文本内容。');
  }
  return {
    chunks,
    previewText: chunks
      .map((item) => item.content)
      .join('\n\n')
      .slice(0, 100_000),
    warnings: [...new Set(parsed.warnings)].slice(0, 100),
  };
}

/** 计算原文件内容哈希，用于重复上传和 revision 幂等判断。 */
export function sourceSha256(buffer: Buffer): string {
  return sha256(buffer);
}
