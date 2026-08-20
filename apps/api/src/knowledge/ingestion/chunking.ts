/**
 * 知识文档规范化与分块。
 *
 * 把格式解析器产生的语义段转换为稳定、可嵌入和可幂等写入的文档块。
 *
 * Responsibilities:
 * - 规范文本、执行重叠分块并计算内容哈希。
 *
 * Notes:
 * - 不解析具体文件格式。
 */
import { createHash } from 'node:crypto';

import type { ParsedChunkDraft, SemanticSection } from './parserTypes.ts';

const TARGET_CHARS = 800;
const MAX_CHARS = 1_200;
const OVERLAP_CHARS = 120;

export function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sha256(value: string | Buffer): string {
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

export function toChunks(documentTitle: string, sections: SemanticSection[]): ParsedChunkDraft[] {
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

