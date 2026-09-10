/**
 * EchoWave Release 工具回归测试。
 *
 * 覆盖版本边界、main 祖先校验、EAS/OCI 输入解析以及可回滚服务器 ZIP 的公开产物契约。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import JSZip from 'jszip';

import { renderReleaseNotes } from './create-release-notes.mjs';
import {
  assertCommitOnMain,
  buildReleaseArtifacts,
  compareVersions,
  findNewMigrationNames,
  findPreviousStableTag,
  parseEasBuildResult,
  parseStableTag,
  releaseAssetNames,
  sha256File,
  validateImageManifest,
  validateReleaseConfiguration,
} from './release-lib.mjs';

function writeFixture(rootDirectory, relativePath, content) {
  const filePath = path.join(rootDirectory, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function createReleaseFixture(testContext, version = '1.2.3', rollbackVersion = '1.2.2') {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), 'echowave-release-'));
  testContext.after(() => rmSync(rootDirectory, { recursive: true, force: true }));
  for (const relativePath of [
    'package.json',
    'apps/api/package.json',
    'apps/mobile/package.json',
    'packages/contracts/package.json',
  ]) {
    writeFixture(rootDirectory, relativePath, JSON.stringify({ version }));
  }
  writeFixture(rootDirectory, 'apps/mobile/app.json', JSON.stringify({ expo: { version } }));
  writeFixture(
    rootDirectory,
    'deploy/release/release.json',
    JSON.stringify({ version, minimumDirectRollbackVersion: rollbackVersion }),
  );
  writeFixture(
    rootDirectory,
    'deploy/release/compose.template.yaml',
    [
      'name: echowave',
      'services:',
      '  migrate:',
      '    image: {{IMAGE_REFERENCE}}',
      '  api:',
      '    image: {{IMAGE_REFERENCE}}',
      'volumes:',
      '  echowave_audio:',
      '  echowave_postgres:',
    ].join('\n'),
  );
  writeFixture(
    rootDirectory,
    'deploy/release/README.md',
    'Version {{VERSION}} {{IMAGE_REFERENCE}} rollback {{MINIMUM_DIRECT_ROLLBACK_VERSION}}',
  );
  writeFixture(rootDirectory, 'deploy/self-hosted/api.env.example', 'PORT=3001\n');
  writeFixture(rootDirectory, 'apps/api/migrations/001_initial.sql', 'SELECT 1;\n');
  writeFixture(rootDirectory, 'apps/api/migrations/sql.sql', 'SELECT 2;\n');
  return rootDirectory;
}

test('accepts stable tags and compares numeric semantic versions', () => {
  assert.equal(parseStableTag('v1.2.3'), '1.2.3');
  assert.equal(compareVersions('1.10.0', '1.2.9') > 0, true);
  assert.throws(() => parseStableTag('v1.2.3-rc.1'), /vMAJOR\.MINOR\.PATCH/);
  assert.throws(() => parseStableTag('1.2.3'), /vMAJOR\.MINOR\.PATCH/);
});

test('keeps the checked-in release metadata aligned with repository versions', () => {
  const rootDirectory = path.resolve(import.meta.dirname, '../..');
  const version = JSON.parse(
    readFileSync(path.join(rootDirectory, 'package.json'), 'utf8'),
  ).version;
  assert.equal(validateReleaseConfiguration(rootDirectory, `v${version}`).version, version);
});

test('uses stable versioned asset names', () => {
  assert.deepEqual(releaseAssetNames('1.2.3'), {
    apk: 'EchoWave-android-v1.2.3.apk',
    server: 'EchoWave-server-v1.2.3.zip',
    manifest: 'EchoWave-release-v1.2.3.json',
    checksums: 'SHA256SUMS-v1.2.3.txt',
  });
});

test('validates every version source and the N-1 rollback floor', (testContext) => {
  const rootDirectory = createReleaseFixture(testContext);
  const result = validateReleaseConfiguration(rootDirectory, 'v1.2.3', 'v1.2.2');
  assert.equal(result.minimumDirectRollbackVersion, '1.2.2');

  writeFixture(rootDirectory, 'apps/mobile/package.json', JSON.stringify({ version: '1.2.4' }));
  assert.throws(
    () => validateReleaseConfiguration(rootDirectory, 'v1.2.3', 'v1.2.2'),
    /apps\/mobile\/package\.json version must be 1\.2\.3/,
  );
});

test('rejects a release that cannot directly roll back to the previous stable version', (testContext) => {
  const rootDirectory = createReleaseFixture(testContext, '1.2.3', '1.2.3');
  assert.throws(
    () => validateReleaseConfiguration(rootDirectory, 'v1.2.3', 'v1.2.2'),
    /must support direct rollback/,
  );
});

test('requires the first release rollback floor to equal its own version', (testContext) => {
  const rootDirectory = createReleaseFixture(testContext, '1.2.3', '1.2.2');
  assert.throws(
    () => validateReleaseConfiguration(rootDirectory, 'v1.2.3'),
    /first stable release.*must equal its version/,
  );
});

test('rejects a tag commit outside main and reports git verification failures', () => {
  assert.doesNotThrow(() =>
    assertCommitOnMain('.', 'a'.repeat(40), 'origin/main', () => ({ status: 0 })),
  );
  assert.throws(
    () => assertCommitOnMain('.', 'a'.repeat(40), 'origin/main', () => ({ status: 1 })),
    /not contained in origin\/main/,
  );
  assert.throws(
    () =>
      assertCommitOnMain('.', 'a'.repeat(40), 'origin/main', () => ({
        status: 128,
        stderr: 'missing ref',
      })),
    /missing ref/,
  );
});

test('selects the latest earlier stable tag from main history', () => {
  const runner = () => ({
    status: 0,
    stdout: 'v2.0.0\nv1.4.0\nv1.3.1\nv1.3.0-rc.1\nnot-a-release\n',
  });
  assert.equal(findPreviousStableTag('.', 'v1.4.0', 'origin/main', runner), 'v1.3.1');
});

test('lists only newly added ordered migrations since the previous stable tag', (testContext) => {
  const rootDirectory = createReleaseFixture(testContext);
  writeFixture(rootDirectory, 'apps/api/migrations/002_second.sql', 'SELECT 2;\n');
  const runner = () => ({
    status: 0,
    stdout: 'apps/api/migrations/002_second.sql\napps/api/migrations/not-a-migration.txt\n',
  });
  assert.deepEqual(findNewMigrationNames(rootDirectory, 'v1.2.2', 'a'.repeat(40), runner), [
    '002_second.sql',
  ]);
});

test('parses EAS artifact output and rejects incomplete results', () => {
  assert.deepEqual(
    parseEasBuildResult([
      {
        id: 'build-id',
        artifacts: { applicationArchiveUrl: 'https://example.com/app.apk' },
        appVersion: '1.2.3',
        appBuildVersion: '42',
      },
    ]),
    {
      id: 'build-id',
      artifactUrl: 'https://example.com/app.apk',
      appVersion: '1.2.3',
      appBuildVersion: '42',
    },
  );
  assert.throws(() => parseEasBuildResult({ id: 'missing-url' }), /artifact URL/);
});

test('requires both supported OCI image platforms', () => {
  const manifests = [
    { platform: { os: 'linux', architecture: 'amd64' } },
    { platform: { os: 'linux', architecture: 'arm64' } },
  ];
  assert.deepEqual(validateImageManifest({ manifests }), ['linux/amd64', 'linux/arm64']);
  assert.throws(() => validateImageManifest({ manifests: manifests.slice(0, 1) }), /linux\/arm64/);
});

test('packages an immutable server bundle and matching public checksums', async (testContext) => {
  const rootDirectory = createReleaseFixture(testContext);
  const apkPath = path.join(rootDirectory, 'input.apk');
  writeFileSync(apkPath, 'signed-apk-fixture');
  const outputDirectory = path.join(rootDirectory, 'output');
  const digest = `sha256:${'b'.repeat(64)}`;
  const result = await buildReleaseArtifacts({
    rootDirectory,
    tag: 'v1.2.3',
    commit: 'a'.repeat(40),
    imageDigest: digest,
    apkPath,
    easBuildResult: {
      id: 'build-id',
      artifactUrl: 'https://example.com/app.apk',
      appVersion: '1.2.3',
      appBuildVersion: '42',
    },
    outputDirectory,
    createdAt: '2026-09-10T00:00:00Z',
    previousStableTag: 'v1.2.2',
    newMigrations: ['001_initial.sql'],
  });

  const archive = await JSZip.loadAsync(readFileSync(result.paths.serverPath));
  assert.deepEqual(Object.keys(archive.files).sort(), [
    'README.md',
    'api.env.example',
    'compose.yaml',
    'release.json',
  ]);
  const compose = await archive.file('compose.yaml').async('string');
  assert.equal(compose.includes('build:'), false);
  assert.equal(compose.includes(':latest'), false);
  assert.equal(compose.split(`ghcr.io/metabrain-labs/echowave-api@${digest}`).length - 1, 2);
  assert.match(compose, /^name: echowave$/m);
  assert.match(compose, /^  echowave_audio:$/m);
  assert.match(compose, /^  echowave_postgres:$/m);

  const internalManifest = JSON.parse(await archive.file('release.json').async('string'));
  assert.equal(internalManifest.database.minimumDirectRollbackVersion, '1.2.2');
  assert.deepEqual(internalManifest.database.migrations, ['001_initial.sql']);
  assert.deepEqual(internalManifest.database.newMigrations, ['001_initial.sql']);
  assert.equal('easBuildUrl' in result.manifest.android, false);
  assert.equal(result.manifest.assets.android.sha256, sha256File(result.paths.finalApkPath));
  assert.match(
    readFileSync(result.paths.checksumsPath, 'utf8'),
    new RegExp(`${result.manifest.assets.server.sha256}  ${result.names.server}`),
  );
});

test('renders operational release notes from the public manifest', () => {
  const notes = renderReleaseNotes(
    {
      tag: 'v1.2.3',
      version: '1.2.3',
      assets: {
        android: { name: 'EchoWave-android-v1.2.3.apk' },
        server: { name: 'EchoWave-server-v1.2.3.zip' },
      },
      image: {
        reference: `ghcr.io/metabrain-labs/echowave-api@sha256:${'b'.repeat(64)}`,
        platforms: ['linux/amd64', 'linux/arm64'],
      },
      database: {
        minimumDirectRollbackVersion: '1.2.2',
        newMigrations: ['003_audio.sql'],
      },
    },
    '## Changes\n\n- Fixed a regression.\n',
  );
  assert.match(notes, /EchoWave-android-v1\.2\.3\.apk/);
  assert.match(notes, /最低 Server 版本：`v1\.2\.2`/);
  assert.match(notes, /本次新增 migration：`003_audio\.sql`/);
  assert.match(notes, /Fixed a regression/);
});
