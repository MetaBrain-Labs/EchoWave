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

export async function parseWord(buffer: Buffer): Promise<{ sections: SemanticSection[]; warnings: string[] }> {
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

