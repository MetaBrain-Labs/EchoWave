/**
 * JSX 文本子节点守卫测试。
 *
 * 扫描移动端全部源码，确保容器组件下不会出现裸字符串子节点：Fabric 渲染器会为它
 * 创建 RCTRawText 并抛出 "Text strings must be rendered within a <Text> component."，
 * 而 jest-expo 使用的旧渲染器不检查该约束，因此必须做静态扫描。
 *
 * Responsibilities:
 * - 拦截 View / Pressable / ScrollView 等容器下的裸字符串与文本表达式。
 * - 允许 Text、TextInput 以及 Text 内部的任意嵌套继续持有文本。
 *
 * Notes:
 * - 只做源码静态检查，不渲染组件；Text 内部的字符串是合法文本。
 * - 使用动态 require 读取源码，避免为移动端引入 Node 类型依赖。
 */
type NodeFs = {
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string) => string[];
  statSync: (path: string) => { isDirectory: () => boolean };
};
type NodePath = { basename: (path: string) => string; join: (...parts: string[]) => string };
type TypeScriptApi = {
  createSourceFile: (
    fileName: string,
    text: string,
    target: unknown,
    setParentNodes: boolean,
    kind: unknown,
  ) => { getLineAndCharacterOfPosition: (position: number) => { line: number } } & TsNode;
  ScriptTarget: { ESNext: unknown };
  ScriptKind: { TSX: unknown };
  isJsxElement: (node: TsNode) => boolean;
  isJsxExpression: (node: TsNode) => boolean;
  isJsxText: (node: TsNode) => boolean;
  isStringLiteral: (node: TsNode) => boolean;
  isTemplateExpression: (node: TsNode) => boolean;
  isNumericLiteral: (node: TsNode) => boolean;
  forEachChild: (node: TsNode, visit: (node: TsNode) => void) => void;
};
type TsNode = {
  children?: TsNode[];
  expression?: unknown;
  openingElement?: { tagName: { getText: (source?: unknown) => string } };
  text?: string;
  getStart: (source?: unknown) => number;
  getText: (source?: unknown) => string;
};

const requireModule = require as (id: string) => unknown;
const fs = requireModule('node:fs') as NodeFs;
const path = requireModule('node:path') as NodePath;
const ts = requireModule('typescript') as TypeScriptApi;

// Jest 的工作目录是 apps/mobile，源码根固定为 src。
const nodeProcess = (globalThis as unknown as { process?: { cwd: () => string } }).process;
const sourceRoot = path.join(nodeProcess?.cwd() ?? '.', 'src');

/** 直接容纳文本的宿主组件；其字符串子节点合法。 */
const textHosts = new Set(['Text', 'TextInput', 'Animated.Text']);

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

/** 判断某节点是否为非法的裸文本子节点。 */
function isRawTextChild(node: TsNode) {
  if (ts.isJsxText(node)) return (node.text ?? '').trim().length > 0;
  if (!ts.isJsxExpression(node) || !node.expression) return false;
  const expression = node.expression as TsNode;
  return (
    ts.isStringLiteral(expression) ||
    ts.isTemplateExpression(expression) ||
    ts.isNumericLiteral(expression)
  );
}

/** 收集容器组件下的裸文本违规，返回 "文件:行" 描述。 */
function findViolations(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  const visit = (node: TsNode, insideText: boolean) => {
    let textContext = insideText;
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement?.tagName.getText(source) ?? '';
      const shortTag = tag.split('.').pop() ?? tag;
      textContext = insideText || textHosts.has(shortTag);
      if (!textContext) {
        for (const child of node.children ?? []) {
          if (!isRawTextChild(child)) continue;
          const { line } = source.getLineAndCharacterOfPosition(child.getStart(source));
          violations.push(
            `${path.basename(file)}:${line + 1} <${shortTag}> → ${child
              .getText(source)
              .trim()
              .slice(0, 40)}`,
          );
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, textContext));
  };
  ts.forEachChild(source, (child) => visit(child, false));
  return violations;
}

describe('JSX 文本子节点约束', () => {
  it('keeps every string child inside a Text or TextInput host', () => {
    const files = collectSourceFiles(sourceRoot);
    const violations = files.flatMap((file) => findViolations(file, fs.readFileSync(file, 'utf8')));

    expect(files.length).toBeGreaterThan(50);
    expect(violations).toEqual([]);
  });
});
