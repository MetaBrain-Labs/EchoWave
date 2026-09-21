/**
 * 知识文档规范化与分块。
 *
 * 把格式解析器产生的语义单元转换为稳定、可嵌入和可幂等写入的文档块，并在来源边界内
 * 执行句子优先、grapheme 兜底的确定性切分。
 *
 * Responsibilities:
 * - 规范文本、合并相邻语义单元并计算内容哈希。
 * - 保留标题来源、内容类型、分段序号和可追溯来源范围。
 *
 * Notes:
 * - 不跨标题路径或 spreadsheet 记录合并内容。
 */
import { createHash } from 'node:crypto';

import type {
  DocumentChunkContentKind,
  DocumentChunkTitleSource,
  SourceLocator,
} from '@echowave/contracts';

import type { ParsedChunkDraft, SemanticSection } from './parserTypes.ts';

const TARGET_CHARS = 800;
const MAX_CHARS = 1_200;
const OVERLAP_CHARS = 120;
const MIN_TAIL_CHARS = 160;
const sentenceSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'sentence' });
const graphemeSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });

type Fragment = {
  content: string;
  contentKind: Exclude<DocumentChunkContentKind, 'mixed' | 'legacy'>;
  locator: SourceLocator;
  overlap?: boolean;
};

type SectionGroup = {
  title: string;
  titleSource: Exclude<DocumentChunkTitleSource, 'legacy'>;
  headingPath: string[];
  sections: SemanticSection[];
};

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

function graphemes(value: string): string[] {
  return [...graphemeSegmenter.segment(value)].map((item) => item.segment);
}

function lengthOf(value: string): number {
  return graphemes(value).length;
}

function hardSplit(value: string): string[] {
  const characters = graphemes(value);
  const pieces: string[] = [];
  let start = 0;
  while (start < characters.length) {
    pieces.push(characters.slice(start, start + MAX_CHARS).join(''));
    if (start + MAX_CHARS >= characters.length) break;
    start += MAX_CHARS - OVERLAP_CHARS;
  }
  return pieces.map(normalizeText).filter(Boolean);
}

function semanticSegments(section: SemanticSection): string[] {
  if (['list', 'table', 'code', 'spreadsheet_record'].includes(section.contentKind)) {
    return section.content.split('\n').map(normalizeText).filter(Boolean);
  }
  return [...sentenceSegmenter.segment(section.content)]
    .map((item) => normalizeText(item.segment))
    .filter(Boolean);
}

function splitSection(section: SemanticSection): Fragment[] {
  if (lengthOf(section.content) <= MAX_CHARS) {
    return [
      { content: section.content, contentKind: section.contentKind, locator: section.locator },
    ];
  }
  const separator = section.contentKind === 'prose' ? ' ' : '\n';
  const pieces: string[] = [];
  let current = '';
  const flush = () => {
    const value = normalizeText(current);
    if (value) pieces.push(value);
    current = '';
  };
  for (const segment of semanticSegments(section)) {
    if (lengthOf(segment) > MAX_CHARS) {
      flush();
      pieces.push(...hardSplit(segment));
      continue;
    }
    const candidate = current ? `${current}${separator}${segment}` : segment;
    if (lengthOf(candidate) <= TARGET_CHARS) current = candidate;
    else {
      flush();
      current = segment;
    }
  }
  flush();
  return pieces.map((content) => ({
    content,
    contentKind: section.contentKind,
    locator: section.locator,
  }));
}

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function groupSections(sections: SemanticSection[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  for (const section of sections) {
    const isolated = section.contentKind.startsWith('spreadsheet_');
    const previous = groups.at(-1);
    if (
      !isolated &&
      previous &&
      previous.title === section.title &&
      previous.titleSource === section.titleSource &&
      samePath(previous.headingPath, section.headingPath) &&
      !previous.sections.some((item) => item.contentKind.startsWith('spreadsheet_'))
    ) {
      previous.sections.push(section);
    } else {
      groups.push({
        title: section.title,
        titleSource: section.titleSource,
        headingPath: [...section.headingPath],
        sections: [section],
      });
    }
  }
  return groups;
}

function trailingOverlap(fragment: Fragment): Fragment | undefined {
  const characters = graphemes(fragment.content);
  if (characters.length <= OVERLAP_CHARS) return { ...fragment, overlap: true };
  const content = normalizeText(characters.slice(-OVERLAP_CHARS).join(''));
  return content ? { ...fragment, content, overlap: true } : undefined;
}

function joinFragments(fragments: Fragment[]): string {
  return normalizeText(fragments.map((item) => item.content).join('\n\n'));
}

function packFragments(fragments: Fragment[]): Fragment[][] {
  const packed: Fragment[][] = [];
  let current: Fragment[] = [];
  for (const fragment of fragments) {
    if (current.length === 0) {
      current = [fragment];
      continue;
    }
    const candidate = joinFragments([...current, fragment]);
    const overlapOnly = current.every((item) => item.overlap);
    if (lengthOf(candidate) <= TARGET_CHARS || (overlapOnly && lengthOf(candidate) <= MAX_CHARS)) {
      current.push(fragment);
      continue;
    }
    packed.push(current);
    const overlap = trailingOverlap(current.at(-1)!);
    current =
      overlap && lengthOf(joinFragments([overlap, fragment])) <= MAX_CHARS
        ? [overlap, fragment]
        : [fragment];
  }
  if (current.length) packed.push(current);

  const tail = packed.at(-1);
  const previous = packed.at(-2);
  if (tail && previous && lengthOf(joinFragments(tail)) < MIN_TAIL_CHARS) {
    const tailWithoutOverlap = tail.filter((item) => !item.overlap);
    const merged = [...previous, ...tailWithoutOverlap];
    if (lengthOf(joinFragments(merged)) <= MAX_CHARS) packed.splice(-2, 2, merged);
  }
  return packed;
}

function mergeLocator(fragments: Fragment[], headingPath: string[]): SourceLocator {
  const first = fragments[0]!.locator;
  const last = fragments.at(-1)!.locator;
  if (first.kind === 'markdown' && last.kind === 'markdown') {
    const locators = fragments
      .map((item) => item.locator)
      .filter((item) => item.kind === 'markdown');
    return {
      kind: 'markdown',
      headingPath,
      lineStart: Math.min(...locators.map((item) => item.lineStart)),
      lineEnd: Math.max(...locators.map((item) => item.lineEnd)),
    };
  }
  if (first.kind === 'word' && last.kind === 'word') {
    const locators = fragments.map((item) => item.locator).filter((item) => item.kind === 'word');
    return {
      kind: 'word',
      headingPath,
      paragraphStart: Math.min(...locators.map((item) => item.paragraphStart)),
      paragraphEnd: Math.max(...locators.map((item) => item.paragraphEnd)),
    };
  }
  if (first.kind === 'spreadsheet' && last.kind === 'spreadsheet') {
    const locators = fragments
      .map((item) => item.locator)
      .filter((item) => item.kind === 'spreadsheet');
    return {
      kind: 'spreadsheet',
      sheet: first.sheet,
      rowStart: Math.min(...locators.map((item) => item.rowStart)),
      rowEnd: Math.max(...locators.map((item) => item.rowEnd)),
    };
  }
  return first;
}

function contentKind(fragments: Fragment[]): DocumentChunkContentKind {
  const kinds = new Set(fragments.filter((item) => !item.overlap).map((item) => item.contentKind));
  return kinds.size === 1 ? [...kinds][0]! : 'mixed';
}

function baseTitle(documentTitle: string, group: SectionGroup): string {
  if (group.title) return group.title;
  if (group.headingPath.length) return group.headingPath.join(' / ');
  return `${documentTitle} · 正文`;
}

/** 把语义段稳定转换为带来源 metadata 的可嵌入文档块。 */
export function toChunks(documentTitle: string, sections: SemanticSection[]): ParsedChunkDraft[] {
  const chunks: ParsedChunkDraft[] = [];
  for (const group of groupSections(sections)) {
    const parts = packFragments(group.sections.flatMap(splitSection));
    const partCount = parts.length;
    const title = baseTitle(documentTitle, group);
    for (let part = 0; part < parts.length; part += 1) {
      const fragments = parts[part]!;
      const content = joinFragments(fragments);
      if (!content) continue;
      const partIndex = part + 1;
      const displayTitle = partCount > 1 ? `${title}（${partIndex}/${partCount}）` : title;
      const kind = contentKind(fragments);
      chunks.push({
        index: chunks.length + 1,
        title: displayTitle,
        titleSource: group.titleSource,
        headingPath: group.headingPath,
        contentKind: kind,
        partIndex,
        partCount,
        content,
        embeddingText: [
          `Document: ${documentTitle}`,
          `Chunk: ${displayTitle}`,
          group.headingPath.length ? `Path: ${group.headingPath.join(' > ')}` : '',
          `Type: ${kind}`,
          `Content: ${content}`,
        ]
          .filter(Boolean)
          .join('\n'),
        contentSha256: sha256(content),
        locator: mergeLocator(fragments, group.headingPath),
      });
    }
  }
  return chunks;
}
