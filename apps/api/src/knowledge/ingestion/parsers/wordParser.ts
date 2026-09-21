/**
 * Word 格式解析器。
 *
 * 把 DOCX 标题和正文结构转换为保留段落范围的语义段。
 *
 * Responsibilities:
 * - 校验 DOCX 容器并提取可见文本。
 *
 * Notes:
 * - 不保存图片或执行 OCR。
 */
import { DomUtils, ElementType, parseDocument as parseHtml } from 'htmlparser2';
import mammoth from 'mammoth';
import type { Element, Node } from 'domhandler';

import { normalizeText } from '../chunking.ts';
import { inspectOfficeArchive } from '../officeArchive.ts';
import type { SemanticSection } from '../parserTypes.ts';

function isElement(node: Node): node is Element {
  return node.type === ElementType.Tag;
}

function descendantsByName(node: Element, names: Set<string>): Element[] {
  return node.children.flatMap((child) => {
    if (!isElement(child)) return [];
    return names.has(child.name.toLowerCase()) ? [child] : descendantsByName(child, names);
  });
}

function wordNodeText(node: Element): string {
  const tag = node.name.toLowerCase();
  if (tag === 'ul' || tag === 'ol') {
    return descendantsByName(node, new Set(['li']))
      .map(
        (item, index) =>
          `${tag === 'ol' ? `${index + 1}.` : '-'} ${normalizeText(DomUtils.textContent(item))}`,
      )
      .join('\n');
  }
  if (tag === 'table') {
    return descendantsByName(node, new Set(['tr']))
      .map((row) => {
        const cells = descendantsByName(row, new Set(['td', 'th']));
        return `| ${cells.map((cell) => normalizeText(DomUtils.textContent(cell))).join(' | ')} |`;
      })
      .join('\n');
  }
  return DomUtils.textContent(node);
}

export async function parseWord(
  buffer: Buffer,
): Promise<{ sections: SemanticSection[]; warnings: string[] }> {
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
    const text = normalizeText(wordNodeText(node));
    if (!text) continue;
    const headingMatch = /^h([1-6])$/.exec(tag);
    if (headingMatch) {
      const depth = Number(headingMatch[1]);
      headingPath.splice(depth - 1);
      headingPath[depth - 1] = text;
      continue;
    }
    if (!['p', 'ul', 'ol', 'table'].includes(tag)) continue;
    paragraph += 1;
    sections.push({
      title: headingPath.join(' / '),
      titleSource: headingPath.length ? 'heading' : 'document',
      headingPath: [...headingPath],
      content: text,
      contentKind: tag === 'ul' || tag === 'ol' ? 'list' : tag === 'table' ? 'table' : 'prose',
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
