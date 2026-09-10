/**
 * 文档结构校验器回归测试。
 *
 * 在临时仓库夹具中验证正常结构、断链、漏索引、关键路径缺失和重复 EAS 配置。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateRepositoryDocs } from './check-docs.mjs';

function writeFixtureFile(rootDirectory, relativePath, content = '') {
  const filePath = path.join(rootDirectory, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function createFixture(testContext) {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), 'echowave-docs-check-'));
  testContext.after(() => rmSync(rootDirectory, { recursive: true, force: true }));
  writeFixtureFile(
    rootDirectory,
    'README.md',
    '**English** | [简体中文](./README.zh-CN.md)\n[文档索引](docs/README.md)',
  );
  writeFixtureFile(rootDirectory, 'README.zh-CN.md', '[English](./README.md) | **简体中文**');
  writeFixtureFile(rootDirectory, 'AGENTS.md', '# Rules');
  writeFixtureFile(
    rootDirectory,
    'docs/topic.md',
    '# Topic\n\n**English** | [简体中文](./topic.zh-CN.md)',
  );
  writeFixtureFile(
    rootDirectory,
    'docs/topic.zh-CN.md',
    '# 主题\n\n[English](./topic.md) | **简体中文**',
  );
  writeFixtureFile(rootDirectory, '.github/workflows/release.yml');
  writeFixtureFile(rootDirectory, 'apps/api/.env.example');
  writeFixtureFile(rootDirectory, 'apps/api/Dockerfile');
  writeFixtureFile(rootDirectory, 'apps/mobile/.env.example');
  writeFixtureFile(
    rootDirectory,
    'apps/mobile/eas.json',
    JSON.stringify({
      cli: { appVersionSource: 'remote' },
      build: {
        development: { developmentClient: true },
        'production-apk': {
          autoIncrement: true,
          android: { buildType: 'apk' },
          env: { EXPO_PUBLIC_REQUIRE_SERVER_SELECTION: 'true' },
        },
        production: { env: { EXPO_PUBLIC_REQUIRE_SERVER_SELECTION: 'true' } },
      },
    }),
  );
  writeFixtureFile(rootDirectory, 'compose.yaml');
  writeFixtureFile(
    rootDirectory,
    'deploy/release/README.md',
    '# Release package\n\n**English** | [简体中文](./README.zh-CN.md)',
  );
  writeFixtureFile(
    rootDirectory,
    'deploy/release/README.zh-CN.md',
    '# 发布包\n\n[English](./README.md) | **简体中文**',
  );
  writeFixtureFile(rootDirectory, 'deploy/release/compose.template.yaml');
  writeFixtureFile(rootDirectory, 'deploy/release/release.json', '{}');
  writeFixtureFile(rootDirectory, 'deploy/self-hosted/api.env.example');
  writeFixtureFile(rootDirectory, 'scripts/release/release-lib.mjs');
  writeFixtureFile(rootDirectory, 'scripts/release/release.test.mjs');
  writeFixtureFile(
    rootDirectory,
    'docs/releases.md',
    '# Releases\n\n**English** | [简体中文](./releases.zh-CN.md)',
  );
  writeFixtureFile(
    rootDirectory,
    'docs/releases.zh-CN.md',
    '# 发布\n\n[English](./releases.md) | **简体中文**',
  );
  writeFixtureFile(
    rootDirectory,
    'docs/self-hosting.md',
    '# Self-hosting\n\n**English** | [简体中文](./self-hosting.zh-CN.md)',
  );
  writeFixtureFile(
    rootDirectory,
    'docs/self-hosting.zh-CN.md',
    '# 自托管\n\n[English](./self-hosting.md) | **简体中文**',
  );
  writeFixtureFile(
    rootDirectory,
    'docs/README.md',
    '**English** | [简体中文](./README.zh-CN.md)\n[导览](./documentation-guide.md)\n[主题](./topic.md)\n[发布](./releases.md)\n[自托管](./self-hosting.md)',
  );
  writeFixtureFile(rootDirectory, 'docs/README.zh-CN.md', '[English](./README.md) | **简体中文**');
  writeFixtureFile(
    rootDirectory,
    'docs/documentation-guide.md',
    [
      '**English** | [简体中文](./documentation-guide.zh-CN.md)',
      '[根 README](../README.md)',
      '[工程规则](../AGENTS.md)',
      '[文档索引](./README.md)',
      '[主题](./topic.md)',
      '[发布](./releases.md)',
      '[自托管](./self-hosting.md)',
      '[发布包](../deploy/release/README.md)',
    ].join('\n'),
  );
  writeFixtureFile(
    rootDirectory,
    'docs/documentation-guide.zh-CN.md',
    '[English](./documentation-guide.md) | **简体中文**',
  );
  return rootDirectory;
}

test('accepts a complete documentation structure and ignores runtime artifacts', (testContext) => {
  const rootDirectory = createFixture(testContext);
  writeFixtureFile(rootDirectory, '.artifacts/maestro/E2E_TEST/triage.md', '# Runtime report');
  assert.deepEqual(validateRepositoryDocs(rootDirectory).errors, []);
});

test('rejects a broken relative link', (testContext) => {
  const rootDirectory = createFixture(testContext);
  writeFixtureFile(rootDirectory, 'docs/topic.md', '[缺失](./missing.md)');
  assert.ok(
    validateRepositoryDocs(rootDirectory).errors.some((error) =>
      error.includes('relative link does not exist'),
    ),
  );
});

test('rejects a topic missing from the documentation index', (testContext) => {
  const rootDirectory = createFixture(testContext);
  writeFixtureFile(
    rootDirectory,
    'docs/unlisted.md',
    '# Unlisted\n\n**English** | [简体中文](./unlisted.zh-CN.md)',
  );
  writeFixtureFile(
    rootDirectory,
    'docs/unlisted.zh-CN.md',
    '# 未列出\n\n[English](./unlisted.md) | **简体中文**',
  );
  assert.ok(
    validateRepositoryDocs(rootDirectory).errors.some((error) =>
      error.includes('topic is not listed'),
    ),
  );
});

test('rejects a missing Simplified Chinese peer', (testContext) => {
  const rootDirectory = createFixture(testContext);
  rmSync(path.join(rootDirectory, 'docs/topic.zh-CN.md'));
  assert.ok(
    validateRepositoryDocs(rootDirectory).errors.some((error) =>
      error.includes('Simplified Chinese peer is missing'),
    ),
  );
});

test('requires English to appear first in every language switcher', (testContext) => {
  const rootDirectory = createFixture(testContext);
  writeFixtureFile(
    rootDirectory,
    'docs/topic.md',
    '# Topic\n\n[简体中文](./topic.zh-CN.md) | **English**',
  );
  assert.ok(
    validateRepositoryDocs(rootDirectory).errors.some((error) =>
      error.includes('language switcher must list active English before Simplified Chinese'),
    ),
  );
});

test('rejects a maintained document missing from the documentation guide', (testContext) => {
  const rootDirectory = createFixture(testContext);
  writeFixtureFile(rootDirectory, 'notes.md', '# Notes');
  assert.ok(
    validateRepositoryDocs(rootDirectory).errors.some((error) =>
      error.includes('maintained document is not described: notes.md'),
    ),
  );
});

test('rejects a missing critical repository path', (testContext) => {
  const rootDirectory = createFixture(testContext);
  rmSync(path.join(rootDirectory, 'compose.yaml'));
  assert.ok(
    validateRepositoryDocs(rootDirectory).errors.some((error) => error.includes('compose.yaml')),
  );
});

test('rejects a duplicate root EAS configuration', (testContext) => {
  const rootDirectory = createFixture(testContext);
  writeFixtureFile(rootDirectory, 'eas.json', '{}');
  assert.ok(
    validateRepositoryDocs(rootDirectory).errors.some((error) =>
      error.includes('duplicate root EAS config'),
    ),
  );
});
