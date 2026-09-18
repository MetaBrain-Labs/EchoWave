/**
 * 输入框文字样式守卫测试。
 *
 * 扫描移动端全部源码里 TextInput 的样式引用，确保每个输入框都应用了
 * `textInputText` 或 `multilineTextInputText`，或显式声明了同一组对齐属性。
 *
 * Responsibilities:
 * - 落实设计系统第 9 节：输入框文字与光标必须落在稳定的行盒内。
 *
 * Notes:
 * - 使用动态 require 读取源码，避免为移动端引入 Node 类型依赖。
 * - 只做源码静态检查，不渲染组件。
 */
type NodeFs = {
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string) => string[];
  statSync: (path: string) => { isDirectory: () => boolean };
};
type NodePath = { join: (...parts: string[]) => string };

const requireModule = require as (id: string) => unknown;
const fs = requireModule('node:fs') as NodeFs;
const path = requireModule('node:path') as NodePath;
// Jest 的工作目录就是 apps/mobile，源码根固定为 src；避免依赖 Node 类型声明。
const nodeProcess = (globalThis as unknown as { process?: { cwd: () => string } }).process;
const sourceRoot = path.join(nodeProcess?.cwd() ?? '.', 'src');

/** 递归收集 .tsx 源文件，跳过测试目录。 */
function collectSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory).flatMap((entry: string) => {
    const fullPath = path.join(directory, entry);
    if (fs.statSync(fullPath).isDirectory()) {
      return entry === '__tests__' ? [] : collectSourceFiles(fullPath);
    }
    return fullPath.endsWith('.tsx') ? [fullPath] : [];
  });
}

/** 取出单个样式键的定义体；统一行尾以便在不同检出配置下匹配。 */
function styleBody(content: string, key: string): string | undefined {
  const normalized = content.replace(/\r\n/g, '\n');
  return normalized.match(new RegExp(`\\n {2}${key}: \\{([\\s\\S]*?)\\n {2}\\},`))?.[1];
}

/** 去掉 `useRef<TextInput>` 与 `useRef<TextInput | null>` 这类泛型引用，避免误判为 JSX 元素。 */
function stripTypeReferences(content: string): string {
  return content
    .replace(/<TextInput\s*\|[^>]*>/g, 'TextInputRef')
    .replace(/<TextInput\s*>/g, 'TextInputRef');
}

describe('text input text styles', () => {
  it('applies a caret-safe text token to every TextInput style', () => {
    const violations: string[] = [];
    for (const file of collectSourceFiles(sourceRoot)) {
      const content = fs.readFileSync(file, 'utf8');
      if (!content.includes('<TextInput')) continue;
      const scannable = stripTypeReferences(content);
      for (const match of scannable.matchAll(/<TextInput\b([\s\S]*?)\/>/g)) {
        const element = match[0];
        const props = match[1];
        if (!props.includes('style=')) continue;
        const keys = [...new Set([...element.matchAll(/styles\.(\w+)/g)].map((item) => item[1]))];
        const bodies = keys
          .map((key) => styleBody(content, key))
          .filter((body): body is string => Boolean(body));
        // 样式可能来自共享组件（例如 SearchSheet），本文件内无法解析时跳过。
        if (!bodies.length) continue;
        const hasToken = bodies.some(
          (body) => body.includes('...textInputText') || body.includes('...multilineTextInputText'),
        );
        const hasInlineRule = bodies.some(
          (body) =>
            body.includes('includeFontPadding: false') && body.includes('textAlignVertical'),
        );
        if (!hasToken && !hasInlineRule) {
          const label = element.match(/accessibilityLabel=\{?([^\n}]+)\}?/)?.[1] ?? '(no label)';
          violations.push(`${file.replace(`${sourceRoot}${path.join('/', '')}`, '')} :: ${label}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps the token rules that hold the caret inside the text line box', () => {
    const token = fs.readFileSync(path.join(sourceRoot, 'shared', 'theme', 'textInput.ts'), 'utf8');
    expect(token).toContain('includeFontPadding: false');
    expect(token).toContain('paddingVertical: 0');
    expect(token).toContain("textAlignVertical: 'center'");
    expect(token).toContain("textAlignVertical: 'top'");
  });
});
