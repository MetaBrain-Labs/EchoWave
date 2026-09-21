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
import type { Root } from 'mdast';

import { normalizeText } from '../chunking.ts';
import { DocumentParseError, type SemanticSection } from '../parserTypes.ts';

function markdownNodeText(node: Root['children'][number]): string {
  if (node.type === 'list') {
    const start = node.start ?? 1;
    return node.children
      .map((item, index) => {
        const marker = node.ordered ? `${start + index}.` : '-';
        const content = normalizeText(toString(item)).replace(/\n/g, '\n  ');
        return `${marker} ${content}`;
      })
      .join('\n');
  }
  if (node.type === 'table') {
    return node.children
      .map((row) => `| ${row.children.map((cell) => normalizeText(toString(cell))).join(' | ')} |`)
      .join('\n');
  }
  return toString(node);
}

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
  for (const node of tree.children) {
    if (node.type === 'heading') {
      const title = normalizeText(toString(node));
      headingPath.splice(node.depth - 1);
      headingPath[node.depth - 1] = title;
    } else {
      const content = normalizeText(markdownNodeText(node));
      if (!content) continue;
      const lineStart = node.position?.start.line ?? 1;
      const lineEnd = node.position?.end.line ?? lineStart;
      const contentKind =
        node.type === 'list'
          ? 'list'
          : node.type === 'table'
            ? 'table'
            : node.type === 'code'
              ? 'code'
              : 'prose';
      sections.push({
        title: headingPath.join(' / '),
        titleSource: headingPath.length ? 'heading' : 'document',
        headingPath: [...headingPath],
        content,
        contentKind,
        locator: { kind: 'markdown', headingPath: [...headingPath], lineStart, lineEnd },
      });
    }
  }
  return { sections, warnings: [] };
}
