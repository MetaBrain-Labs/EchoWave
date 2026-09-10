/**
 * EchoWave Release 发布工具库。
 *
 * 集中实现稳定版本校验、EAS 结果解析、服务器部署包生成与产物摘要，确保本地测试和
 * GitHub Actions 使用同一套发布规则。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import JSZip from 'jszip';

export const RELEASE_IMAGE_REPOSITORY = 'ghcr.io/metabrain-labs/echowave-api';
export const REQUIRED_IMAGE_PLATFORMS = ['linux/amd64', 'linux/arm64'];

const STABLE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ZIP_DATE = new Date('1980-01-01T00:00:00.000Z');

const VERSION_SOURCES = [
  ['package.json', (value) => value.version],
  ['apps/api/package.json', (value) => value.version],
  ['apps/mobile/package.json', (value) => value.version],
  ['packages/contracts/package.json', (value) => value.version],
  ['apps/mobile/app.json', (value) => value.expo?.version],
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function parseVersion(version, label) {
  const match = VERSION_PATTERN.exec(version);
  if (!match) throw new Error(`${label} must be a stable semantic version, received ${version}.`);
  return match.slice(1).map(Number);
}

/** 将稳定发布 Tag 转换为不含 v 前缀的版本号。 */
export function parseStableTag(tag) {
  const match = STABLE_TAG_PATTERN.exec(tag);
  if (!match) throw new Error(`Release tag must match vMAJOR.MINOR.PATCH, received ${tag}.`);
  return match.slice(1).join('.');
}

/** 比较两个不含前缀的稳定语义版本。 */
export function compareVersions(left, right) {
  const leftParts = parseVersion(left, 'Left version');
  const rightParts = parseVersion(right, 'Right version');
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

/** 返回固定、可预测的 Release 资产名称。 */
export function releaseAssetNames(version) {
  parseVersion(version, 'Release version');
  return {
    apk: `EchoWave-android-v${version}.apk`,
    server: `EchoWave-server-v${version}.zip`,
    manifest: `EchoWave-release-v${version}.json`,
    checksums: `SHA256SUMS-v${version}.txt`,
  };
}

/** 校验仓库内全部版本来源和数据库直接回退窗口。 */
export function validateReleaseConfiguration(rootDirectory, tag, previousStableTag = null) {
  const version = parseStableTag(tag);
  const versionSources = VERSION_SOURCES.map(([relativePath, select]) => {
    const value = select(readJson(path.join(rootDirectory, relativePath)));
    if (value !== version) {
      throw new Error(`${relativePath} version must be ${version}, received ${String(value)}.`);
    }
    return { path: relativePath, version: value };
  });

  const metadataPath = path.join(rootDirectory, 'deploy/release/release.json');
  const metadata = readJson(metadataPath);
  if (metadata.version !== version) {
    throw new Error(`deploy/release/release.json version must be ${version}.`);
  }
  parseVersion(metadata.minimumDirectRollbackVersion, 'minimumDirectRollbackVersion');
  if (compareVersions(metadata.minimumDirectRollbackVersion, version) > 0) {
    throw new Error('minimumDirectRollbackVersion cannot be newer than the release version.');
  }

  if (!previousStableTag && metadata.minimumDirectRollbackVersion !== version) {
    throw new Error(
      'The first stable release minimumDirectRollbackVersion must equal its version.',
    );
  }

  if (previousStableTag) {
    const previousVersion = parseStableTag(previousStableTag);
    if (compareVersions(previousVersion, version) >= 0) {
      throw new Error('The previous stable release must be older than the current release.');
    }
    if (compareVersions(metadata.minimumDirectRollbackVersion, previousVersion) > 0) {
      throw new Error(
        `Release ${tag} must support direct rollback to the previous stable release ${previousStableTag}.`,
      );
    }
  }

  return {
    tag,
    version,
    previousStableTag,
    minimumDirectRollbackVersion: metadata.minimumDirectRollbackVersion,
    versionSources,
  };
}

/** 确认 Tag 指向的提交已经进入远端 main 历史。 */
export function assertCommitOnMain(
  rootDirectory,
  commit,
  mainRef = 'origin/main',
  runner = spawnSync,
) {
  const result = runner('git', ['merge-base', '--is-ancestor', commit, mainRef], {
    cwd: rootDirectory,
    encoding: 'utf8',
  });
  if (result.status === 0) return;
  if (result.status === 1) {
    throw new Error(`Release commit ${commit} is not contained in ${mainRef}.`);
  }
  throw new Error(
    `Unable to verify release ancestry: ${(result.stderr || result.stdout || 'git failed').trim()}`,
  );
}

/** 查找 main 历史上早于当前版本的最近稳定 Tag。 */
export function findPreviousStableTag(
  rootDirectory,
  currentTag,
  mainRef = 'origin/main',
  runner = spawnSync,
) {
  const currentVersion = parseStableTag(currentTag);
  const result = runner('git', ['tag', '--merged', mainRef, '--sort=-version:refname'], {
    cwd: rootDirectory,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Unable to list stable tags: ${(result.stderr || result.stdout).trim()}`);
  }
  return (
    result.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => STABLE_TAG_PATTERN.test(value))
      .find((value) => compareVersions(parseStableTag(value), currentVersion) < 0) ?? null
  );
}

/** 解析 EAS Build 的机器输出并提取 APK 下载信息。 */
export function parseEasBuildResult(content) {
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  const build = Array.isArray(parsed) ? parsed[0] : parsed;
  const artifactUrl =
    build?.artifacts?.applicationArchiveUrl ?? build?.artifacts?.buildUrl ?? build?.artifactUrl;
  if (!build?.id || !artifactUrl) {
    throw new Error('EAS build output does not contain a build id and APK artifact URL.');
  }
  return {
    id: String(build.id),
    artifactUrl: String(artifactUrl),
    appVersion: build.appVersion ? String(build.appVersion) : null,
    appBuildVersion: build.appBuildVersion ? String(build.appBuildVersion) : null,
  };
}

/** 校验 Buildx 生成的 OCI manifest 同时包含两种受支持架构。 */
export function validateImageManifest(content) {
  const manifest = typeof content === 'string' ? JSON.parse(content) : content;
  const available = new Set(
    (manifest.manifests ?? []).map(
      (entry) => `${entry.platform?.os}/${entry.platform?.architecture}`,
    ),
  );
  const missing = REQUIRED_IMAGE_PLATFORMS.filter((platform) => !available.has(platform));
  if (missing.length > 0)
    throw new Error(`Container image is missing platforms: ${missing.join(', ')}.`);
  return [...available].sort();
}

/** 计算文件的 SHA-256。 */
export function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function migrationNames(rootDirectory) {
  return readdirSync(path.join(rootDirectory, 'apps/api/migrations'))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
}

/** 返回相对上一稳定 Tag 本次新增的有序 SQL migration。 */
export function findNewMigrationNames(
  rootDirectory,
  previousStableTag,
  commit,
  runner = spawnSync,
) {
  const allMigrations = migrationNames(rootDirectory);
  if (!previousStableTag) return allMigrations;
  parseStableTag(previousStableTag);
  const result = runner(
    'git',
    [
      'diff',
      '--name-only',
      '--diff-filter=A',
      `${previousStableTag}..${commit}`,
      '--',
      'apps/api/migrations',
    ],
    { cwd: rootDirectory, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `Unable to list new migrations: ${(result.stderr || result.stdout || 'git failed').trim()}`,
    );
  }
  const knownMigrations = new Set(allMigrations);
  return result.stdout
    .split(/\r?\n/)
    .map((filePath) => path.basename(filePath.trim()))
    .filter((name) => knownMigrations.has(name))
    .sort();
}

function replaceTemplate(content, values) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    content,
  );
}

/** 生成固定镜像 digest 的服务器 ZIP、Release manifest 与校验文件。 */
export async function buildReleaseArtifacts(options) {
  const {
    rootDirectory,
    tag,
    commit,
    imageRepository = RELEASE_IMAGE_REPOSITORY,
    imageDigest,
    apkPath,
    easBuildResult,
    outputDirectory,
    createdAt,
    previousStableTag = null,
    newMigrations = null,
  } = options;
  const validation = validateReleaseConfiguration(rootDirectory, tag, previousStableTag);
  if (!DIGEST_PATTERN.test(imageDigest)) {
    throw new Error(`Image digest must be sha256:<64 lowercase hex characters>.`);
  }
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Commit must be a full lowercase Git SHA.');
  if (easBuildResult.appVersion && easBuildResult.appVersion !== validation.version) {
    throw new Error(
      `EAS app version must be ${validation.version}, received ${easBuildResult.appVersion}.`,
    );
  }

  mkdirSync(outputDirectory, { recursive: true });
  const names = releaseAssetNames(validation.version);
  const finalApkPath = path.join(outputDirectory, names.apk);
  copyFileSync(apkPath, finalApkPath);

  const imageReference = `${imageRepository}@${imageDigest}`;
  const templateValues = {
    VERSION: validation.version,
    TAG: tag,
    IMAGE_REFERENCE: imageReference,
    MINIMUM_DIRECT_ROLLBACK_VERSION: validation.minimumDirectRollbackVersion,
  };
  const compose = replaceTemplate(
    readFileSync(path.join(rootDirectory, 'deploy/release/compose.template.yaml'), 'utf8'),
    templateValues,
  );
  if (/^\s*build\s*:/m.test(compose) || /:latest(?:\s|$)/m.test(compose)) {
    throw new Error(
      'Generated release Compose must use an immutable image digest without build or latest.',
    );
  }
  if (compose.split(imageReference).length - 1 !== 2) {
    throw new Error('Generated release Compose must use the same API image for migrate and api.');
  }

  const database = {
    backupRequiredBeforeUpgrade: true,
    minimumDirectRollbackVersion: validation.minimumDirectRollbackVersion,
    migrations: migrationNames(rootDirectory),
    newMigrations: newMigrations ?? findNewMigrationNames(rootDirectory, previousStableTag, commit),
  };
  const serverRelease = {
    schemaVersion: 1,
    version: validation.version,
    tag,
    commit,
    image: {
      repository: imageRepository,
      digest: imageDigest,
      reference: imageReference,
      platforms: REQUIRED_IMAGE_PLATFORMS,
    },
    database,
  };
  const serverReadme = replaceTemplate(
    readFileSync(path.join(rootDirectory, 'deploy/release/README.md'), 'utf8'),
    templateValues,
  );
  const zip = new JSZip();
  const zipOptions = { date: ZIP_DATE, unixPermissions: 0o644 };
  zip.file('compose.yaml', compose, zipOptions);
  zip.file(
    'api.env.example',
    readFileSync(path.join(rootDirectory, 'deploy/self-hosted/api.env.example')),
    zipOptions,
  );
  zip.file('README.md', serverReadme, zipOptions);
  zip.file('release.json', `${JSON.stringify(serverRelease, null, 2)}\n`, zipOptions);
  const serverPath = path.join(outputDirectory, names.server);
  writeFileSync(
    serverPath,
    await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: 'UNIX',
    }),
  );

  const manifest = {
    schemaVersion: 1,
    version: validation.version,
    tag,
    commit,
    createdAt,
    previousStableTag,
    android: {
      package: 'com.echowave.app',
      easBuildId: easBuildResult.id,
      appVersion: easBuildResult.appVersion,
      appBuildVersion: easBuildResult.appBuildVersion,
    },
    image: serverRelease.image,
    database,
    assets: {
      android: {
        name: names.apk,
        size: statSync(finalApkPath).size,
        sha256: sha256File(finalApkPath),
      },
      server: {
        name: names.server,
        size: statSync(serverPath).size,
        sha256: sha256File(serverPath),
      },
    },
  };
  const manifestPath = path.join(outputDirectory, names.manifest);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const checksumsPath = path.join(outputDirectory, names.checksums);
  const checksums = [names.apk, names.server, names.manifest]
    .map((name) => `${sha256File(path.join(outputDirectory, name))}  ${name}`)
    .join('\n');
  writeFileSync(checksumsPath, `${checksums}\n`, 'utf8');

  return {
    validation,
    names,
    manifest,
    paths: { finalApkPath, serverPath, manifestPath, checksumsPath },
  };
}

/** 以 GitHub Actions 的单行 output 格式写出可信值。 */
export function appendGitHubOutput(outputPath, values) {
  if (!outputPath) return;
  for (const [key, rawValue] of Object.entries(values)) {
    const value = rawValue ?? '';
    if (!/^[a-z_][a-z0-9_]*$/.test(key) || /[\r\n]/.test(String(value))) {
      throw new Error('GitHub output keys and values must be single-line trusted values.');
    }
    appendFileSync(outputPath, `${key}=${String(value)}\n`, 'utf8');
  }
}
