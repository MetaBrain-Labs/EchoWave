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
  writeFixtureFile(rootDirectory, 'README.md', '[文档索引](docs/README.md)');
  writeFixtureFile(rootDirectory, 'AGENTS.md', '# Rules');
  writeFixtureFile(rootDirectory, 'docs/topic.md', '# Topic');
  writeFixtureFile(rootDirectory, 'apps/api/.env.example');
  writeFixtureFile(rootDirectory, 'apps/api/Dockerfile');
  writeFixtureFile(rootDirectory, 'apps/mobile/.env.example');
  writeFixtureFile(
    rootDirectory,
    'apps/mobile/eas.json',
    JSON.stringify({
      build: {
        development: { developmentClient: true },
        'production-apk': {
          android: { buildType: 'apk' },
          env: { EXPO_PUBLIC_REQUIRE_SERVER_SELECTION: 'true' },
        },
        production: { env: { EXPO_PUBLIC_REQUIRE_SERVER_SELECTION: 'true' } },
      },
    }),
  );
  writeFixtureFile(rootDirectory, 'compose.yaml');
  writeFixtureFile(rootDirectory, 'deploy/self-hosted/api.env.example');
  writeFixtureFile(rootDirectory, 'docs/self-hosting.md', '# Self-hosting');
  writeFixtureFile(
    rootDirectory,
    'docs/README.md',
    '[导览](./documentation-guide.md)\n[主题](./topic.md)\n[自托管](./self-hosting.md)',
  );
  writeFixtureFile(
    rootDirectory,
    'docs/documentation-guide.md',
    [
      '[根 README](../README.md)',
      '[工程规则](../AGENTS.md)',
      '[文档索引](./README.md)',
      '[主题](./topic.md)',
      '[自托管](./self-hosting.md)',
    ].join('\n'),
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
  writeFixtureFile(rootDirectory, 'docs/unlisted.md', '# Unlisted');
  assert.ok(
    validateRepositoryDocs(rootDirectory).errors.some((error) =>
      error.includes('topic is not listed'),
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
