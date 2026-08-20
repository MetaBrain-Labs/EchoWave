/**
 * 知识文档解析模块。
 *
 * 将受支持的 Markdown、Word 与 Spreadsheet 内容转换为可追溯的语义文档块，
 * 同时保留标题路径、行段范围和预览文本。
 *
 * Responsibilities:
 * - 验证并解析支持的文档格式。
 * - 生成稳定的文档块、定位信息与 embedding 文本。
 * - 将解析失败归一化为安全错误。
 *
 * Notes:
 * - 本文件不写数据库，也不调用外部 embedding 服务。
 */
import { createHash } from 'node:crypto';

import ExcelJS from 'exceljs';
import { DomUtils, ElementType, parseDocument as parseHtml } from 'htmlparser2';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified, type Plugin } from 'unified';

import type { DocumentFormat, SourceLocator } from '@echowave/contracts';
import type { Element, Node } from 'domhandler';
import type { Root, RootContent } from 'mdast';

const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 5_000_000;
const MAX_VISIBLE_WORKSHEETS = 50;
const MAX_NON_EMPTY_CELLS = 200_000;
const TARGET_CHARS = 800;
const MAX_CHARS = 1_200;
const OVERLAP_CHARS = 120;

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

type SemanticSection = {
  title: string;
  headingPath: string[];
  content: string;
  locator: SourceLocator;
};

function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function splitSection(section: SemanticSection): string[] {
  const content = section.content;
  if (Array.from(content).length <= MAX_CHARS) return [content];

  const paragraphs = content.split(/\n{2,}/).filter(Boolean);
  const pieces: string[] = [];
  let current = '';

  const flush = () => {
    const normalized = normalizeText(current);
    if (normalized) pieces.push(normalized);
    current = '';
  };

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (Array.from(candidate).length <= TARGET_CHARS) {
      current = candidate;
      continue;
    }
    if (current) flush();

    let remaining = paragraph;
    while (Array.from(remaining).length > MAX_CHARS) {
      const characters = Array.from(remaining);
      const piece = characters.slice(0, MAX_CHARS).join('');
      pieces.push(normalizeText(piece));
      remaining = characters.slice(MAX_CHARS - OVERLAP_CHARS).join('');
    }
    current = remaining;
  }
  if (current) flush();
  return pieces;
}

function toChunks(documentTitle: string, sections: SemanticSection[]): ParsedChunkDraft[] {
  const chunks: ParsedChunkDraft[] = [];
  for (const section of sections) {
    for (const content of splitSection(section)) {
      if (!content) continue;
      const heading = section.headingPath.join(' > ');
      chunks.push({
        index: chunks.length + 1,
        title: section.title || documentTitle,
        headingPath: section.headingPath,
        content,
        embeddingText: [`Document: ${documentTitle}`, heading && `Section: ${heading}`, content]
          .filter(Boolean)
          .join('\n'),
        contentSha256: sha256(content),
        locator: section.locator,
      });
    }
  }
  return chunks;
}

async function inspectOfficeArchive(buffer: Buffer, requiredEntry: string): Promise<void> {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new DocumentParseError('INVALID_FILE', 'Office 文件不是有效的 ZIP 容器。');
  }
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch {
    throw new DocumentParseError('INVALID_FILE', 'Office 文件已损坏或无法解压。');
  }
  if (!archive.file(requiredEntry)) {
    throw new DocumentParseError('INVALID_FILE', '文件内容与扩展名不匹配。');
  }

  let uncompressedBytes = 0;
  for (const entry of Object.values(archive.files)) {
    const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
    uncompressedBytes += data?.uncompressedSize ?? 0;
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new DocumentParseError('DOCUMENT_TOO_LARGE', '解压后的文件内容超过 100 MB。');
    }
  }
}

function parseMarkdown(buffer: Buffer): { sections: SemanticSection[]; warnings: string[] } {
  const source = buffer.toString('utf8');
  if (source.includes('\u0000')) {
    throw new DocumentParseError('INVALID_FILE', 'Markdown 文件包含无效的二进制内容。');
  }
  let markdown = source;
  let frontmatterTitle = '';
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(source);
  if (frontmatter) {
    frontmatterTitle =
      /^title:\s*(?:["']([^"']+)["']|(.+))$/im.exec(frontmatter[1] ?? '')?.slice(1).find(Boolean)?.trim() ?? '';
    markdown = `${frontmatter[0].replace(/[^\r\n]/g, ' ')}${source.slice(frontmatter[0].length)}`;
  }
  const tree = unified()
    .use(remarkParse as unknown as Plugin)
    .use(remarkGfm as unknown as Plugin)
    .parse(markdown) as Root;
  const sections: SemanticSection[] = [];
  const headingPath: string[] = frontmatterTitle ? [frontmatterTitle] : [];
  let currentNodes: RootContent[] = [];
  let currentTitle = '';
  let lineStart = 1;

  const flush = (lineEnd: number) => {
    const content = normalizeText(currentNodes.map((node) => toString(node)).join('\n\n'));
    if (content) {
      sections.push({
        title: currentTitle,
        headingPath: [...headingPath],
        content,
        locator: {
          kind: 'markdown',
          headingPath: [...headingPath],
          lineStart,
          lineEnd: Math.max(lineStart, lineEnd),
        },
      });
    }
    currentNodes = [];
  };

  for (const node of tree.children) {
    if (node.type === 'heading') {
      flush((node.position?.start.line ?? lineStart) - 1);
      const title = normalizeText(toString(node));
      headingPath.splice(node.depth - 1);
      headingPath[node.depth - 1] = title;
      currentTitle = title;
      lineStart = (node.position?.end.line ?? node.position?.start.line ?? lineStart) + 1;
    } else {
      if (currentNodes.length === 0) lineStart = node.position?.start.line ?? lineStart;
      currentNodes.push(node);
    }
  }
  flush(tree.position?.end.line ?? lineStart);
  return { sections, warnings: [] };
}

function isElement(node: Node): node is Element {
  return node.type === ElementType.Tag;
}

async function parseWord(buffer: Buffer): Promise<{ sections: SemanticSection[]; warnings: string[] }> {
  await inspectOfficeArchive(buffer, 'word/document.xml');
  const result = await mammoth.convertToHtml(
    { buffer },
    { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })) },
  );
  const document = parseHtml(result.value);
  const sections: SemanticSection[] = [];
  const headingPath: string[] = [];
  let paragraph = 0;

  for (const node of document.children) {
    if (!isElement(node)) continue;
    const tag = node.name.toLowerCase();
    const text = normalizeText(DomUtils.textContent(node));
    if (!text) continue;
    const headingMatch = /^h([1-6])$/.exec(tag);
    if (headingMatch) {
      const depth = Number(headingMatch[1]);
      headingPath.splice(depth - 1);
      headingPath[depth - 1] = text;
      continue;
    }
    paragraph += 1;
    if (!['p', 'ul', 'ol', 'table'].includes(tag)) continue;
    sections.push({
      title: headingPath.at(-1) ?? `段落 ${paragraph}`,
      headingPath: [...headingPath],
      content: text,
      locator: {
        kind: 'word',
        headingPath: [...headingPath],
        paragraphStart: paragraph,
        paragraphEnd: paragraph,
      },
    });
  }

  return {
    sections,
    warnings: result.messages.map((message) => message.message),
  };
}

function spreadsheetCellText(cell: ExcelJS.Cell, warnings: string[]): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('formula' in value) {
      if (value.result !== undefined && value.result !== null) return String(value.result);
      warnings.push(`单元格 ${cell.address} 的公式没有缓存结果。`);
      return `=${value.formula}`;
    }
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
    if ('error' in value) return `[${value.error}]`;
  }
  return String(value);
}

async function parseSpreadsheet(
  buffer: Buffer,
): Promise<{ sections: SemanticSection[]; warnings: string[] }> {
  await inspectOfficeArchive(buffer, 'xl/workbook.xml');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const warnings: string[] = [];
  const sections: SemanticSection[] = [];
  const visibleSheets = workbook.worksheets.filter((sheet) => sheet.state === 'visible');
  if (visibleSheets.length > MAX_VISIBLE_WORKSHEETS) {
    throw new DocumentParseError('DOCUMENT_TOO_LARGE', '可见工作表数量超过 50。');
  }

  let nonEmptyCells = 0;
  for (const sheet of visibleSheets) {
    const rows: { number: number; values: string[] }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        nonEmptyCells += 1;
        if (nonEmptyCells > MAX_NON_EMPTY_CELLS) {
          throw new DocumentParseError('DOCUMENT_TOO_LARGE', '非空单元格数量超过 200000。');
        }
        values[Number(cell.col) - 1] = spreadsheetCellText(cell, warnings);
      });
      if (values.some(Boolean)) rows.push({ number: rowNumber, values });
    });
    if (rows.length < 2) continue;

    const firstRow = rows[0];
    if (!firstRow) continue;
    const header = firstRow.values.map((value, index) => value || `列 ${index + 1}`);
    let batch: typeof rows = [];
    let batchChars = 0;
    const flush = () => {
      if (batch.length === 0) return;
      const firstBatchRow = batch[0];
      if (!firstBatchRow) return;
      const lines = batch.map((row) =>
        header
          .map((label, index) => `${label}: ${row.values[index] ?? ''}`)
          .filter((item) => !item.endsWith(': '))
          .join(' | '),
      );
      sections.push({
        title: sheet.name,
        headingPath: [sheet.name],
        content: normalizeText([`表头: ${header.join(' | ')}`, ...lines].join('\n')),
        locator: {
          kind: 'spreadsheet',
          sheet: sheet.name,
          rowStart: firstBatchRow.number,
          rowEnd: batch.at(-1)?.number ?? firstBatchRow.number,
        },
      });
      batch = [];
      batchChars = 0;
    };

    for (const row of rows.slice(1)) {
      const rowChars = row.values.join(' ').length;
      if (batch.length >= 20 || (batch.length > 0 && batchChars + rowChars > MAX_CHARS)) flush();
      batch.push(row);
      batchChars += rowChars;
    }
    flush();
  }
  return { sections, warnings };
}

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
    previewText: chunks.map((chunk) => chunk.content).join('\n\n').slice(0, 100_000),
    warnings: [...new Set(parsed.warnings)].slice(0, 100),
  };
}

/** 计算原文件内容哈希，用于重复上传和 revision 幂等判断。 */
export function sourceSha256(buffer: Buffer): string {
  return sha256(buffer);
}
