/**
 * Markdown 格式解析器。
 *
 * 把 Markdown 标题层级和正文转换为保留行号范围的语义段。
 *
 * Responsibilities:
 * - 解析 frontmatter、GFM 和标题路径。
 *
 * Notes:
 * - 不执行通用分块。
 */
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified, type Plugin } from 'unified';
import type { Root, RootContent } from 'mdast';

import { normalizeText } from '../chunking.ts';
import { DocumentParseError, type SemanticSection } from '../parserTypes.ts';

export function parseMarkdown(buffer: Buffer): { sections: SemanticSection[]; warnings: string[] } {
  const source = buffer.toString('utf8');
  if (source.includes('\u0000')) {
    throw new DocumentParseError('INVALID_FILE', 'Markdown 文件包含无效的二进制内容。');
  }
  let markdown = source;
  let frontmatterTitle = '';
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(source);
  if (frontmatter) {
    frontmatterTitle =
      /^title:\s*(?:["']([^"']+)["']|(.+))$/im
        .exec(frontmatter[1] ?? '')
        ?.slice(1)
        .find(Boolean)
        ?.trim() ?? '';
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
