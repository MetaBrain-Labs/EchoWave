/**
 * EchoWave 文档结构校验器。
 *
 * 使用 Node.js 标准库检查人维护 Markdown 的相对链接、专题索引和关键运行入口，
 * 避免文档继续引用已删除文件或错误的 EAS 配置位置。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IGNORED_DIRECTORIES = new Set([
  '.agents',
  '.ai-execution-reports',
  '.artifacts',
  '.cache',
  '.codex',
  '.expo',
  '.git',
  '.next',
  '.pnpm-store',
  '.tmp',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'node_modules.previous',
]);

const REQUIRED_PATHS = [
  '.github/workflows/release.yml',
  'apps/api/.env.example',
  'apps/api/Dockerfile',
  'apps/mobile/.env.example',
  'apps/mobile/eas.json',
  'compose.yaml',
  'deploy/release/README.md',
  'deploy/release/compose.template.yaml',
  'deploy/release/release.json',
  'deploy/self-hosted/api.env.example',
  'docs/README.md',
  'docs/documentation-guide.md',
  'docs/releases.md',
  'docs/self-hosting.md',
  'scripts/release/release-lib.mjs',
  'scripts/release/release.test.mjs',
];

function collectMarkdownFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(absolutePath, files);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(absolutePath);
  }
  return files;
}

function markdownLinkTargets(content) {
  const targets = [];
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(pattern)) {
    let target = match[1]?.trim() ?? '';
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    const titleSeparator = target.search(/\s+["']/);
    if (titleSeparator >= 0) target = target.slice(0, titleSeparator);
    targets.push(target);
  }
  return targets;
}

function isExternalTarget(target) {
  return !target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function resolveLocalTarget(markdownFile, target) {
  const withoutFragment = target.split('#', 1)[0] ?? '';
  try {
    return path.resolve(path.dirname(markdownFile), decodeURIComponent(withoutFragment));
  } catch {
    return null;
  }
}

function validateRelativeLinks(rootDirectory, markdownFiles) {
  const errors = [];
  for (const markdownFile of markdownFiles) {
    const content = readFileSync(markdownFile, 'utf8');
    for (const target of markdownLinkTargets(content)) {
      if (isExternalTarget(target)) continue;
      const resolved = resolveLocalTarget(markdownFile, target);
      if (!resolved || !existsSync(resolved)) {
        errors.push(
          `${path.relative(rootDirectory, markdownFile)}: relative link does not exist: ${target}`,
        );
      }
    }
  }
  return errors;
}

function validateDocumentationIndex(rootDirectory) {
  const docsDirectory = path.join(rootDirectory, 'docs');
  const indexPath = path.join(docsDirectory, 'README.md');
  if (!existsSync(indexPath)) return ['docs/README.md: documentation index is missing'];

  const indexedTargets = new Set(
    markdownLinkTargets(readFileSync(indexPath, 'utf8'))
      .filter((target) => !isExternalTarget(target))
      .map((target) => resolveLocalTarget(indexPath, target))
      .filter(Boolean)
      .map((target) => path.normalize(target)),
  );
  const topicFiles = readdirSync(docsDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name !== 'README.md',
    )
    .map((entry) => path.normalize(path.join(docsDirectory, entry.name)));

  return topicFiles
    .filter((topicFile) => !indexedTargets.has(topicFile))
    .map(
      (topicFile) =>
        `docs/README.md: topic is not listed: ${path.relative(rootDirectory, topicFile)}`,
    );
}

function validateDocumentationGuide(rootDirectory, markdownFiles) {
  const guidePath = path.join(rootDirectory, 'docs/documentation-guide.md');
  if (!existsSync(guidePath)) {
    return ['docs/documentation-guide.md: documentation guide is missing'];
  }

  const describedTargets = new Set(
    markdownLinkTargets(readFileSync(guidePath, 'utf8'))
      .filter((target) => !isExternalTarget(target))
      .map((target) => resolveLocalTarget(guidePath, target))
      .filter(Boolean)
      .map((target) => path.normalize(target)),
  );

  return markdownFiles
    .map((markdownFile) => path.normalize(markdownFile))
    .filter((markdownFile) => markdownFile !== path.normalize(guidePath))
    .filter((markdownFile) => !describedTargets.has(markdownFile))
    .map(
      (markdownFile) =>
        `docs/documentation-guide.md: maintained document is not described: ${path.relative(rootDirectory, markdownFile)}`,
    );
}

function validateCriticalPaths(rootDirectory) {
  const errors = REQUIRED_PATHS.filter(
    (relativePath) => !existsSync(path.join(rootDirectory, relativePath)),
  ).map((relativePath) => `required repository path is missing: ${relativePath}`);

  if (existsSync(path.join(rootDirectory, 'eas.json'))) {
    errors.push('eas.json: duplicate root EAS config is not allowed; use apps/mobile/eas.json');
  }

  const easPath = path.join(rootDirectory, 'apps/mobile/eas.json');
  if (!existsSync(easPath)) return errors;
  try {
    const eas = JSON.parse(readFileSync(easPath, 'utf8'));
    if (eas.build?.development?.developmentClient !== true) {
      errors.push('apps/mobile/eas.json: development profile must enable developmentClient');
    }
    if (eas.build?.['production-apk']?.android?.buildType !== 'apk') {
      errors.push('apps/mobile/eas.json: production-apk profile must produce an APK');
    }
    if (eas.cli?.appVersionSource !== 'remote') {
      errors.push('apps/mobile/eas.json: appVersionSource must use EAS remote versioning');
    }
    if (eas.build?.['production-apk']?.autoIncrement !== true) {
      errors.push('apps/mobile/eas.json: production-apk must auto increment Android versionCode');
    }
    for (const profile of ['production-apk', 'production']) {
      if (eas.build?.[profile]?.env?.EXPO_PUBLIC_REQUIRE_SERVER_SELECTION !== 'true') {
        errors.push(`apps/mobile/eas.json: ${profile} must require runtime server selection`);
      }
    }
  } catch (error) {
    errors.push(
      `apps/mobile/eas.json: cannot parse configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return errors;
}

/** 返回文档与关键入口的全部稳定校验错误。 */
export function validateRepositoryDocs(rootDirectory) {
  const resolvedRoot = path.resolve(rootDirectory);
  const markdownFiles = collectMarkdownFiles(resolvedRoot);
  return {
    errors: [
      ...validateRelativeLinks(resolvedRoot, markdownFiles),
      ...validateDocumentationIndex(resolvedRoot),
      ...validateDocumentationGuide(resolvedRoot, markdownFiles),
      ...validateCriticalPaths(resolvedRoot),
    ],
    markdownFileCount: markdownFiles.length,
  };
}

function runCli() {
  const result = validateRepositoryDocs(process.cwd());
  if (result.errors.length > 0) {
    console.error('Documentation check failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Documentation check passed (${result.markdownFileCount} Markdown files).`);
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entryPath === import.meta.url) runCli();
