/**
 * EchoWave Release 资产打包入口。
 *
 * 汇总已验证的 APK、EAS 构建结果和多架构镜像 digest，生成可下载服务器包、公开 manifest
 * 与 SHA-256 校验文件。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildReleaseArtifacts, parseEasBuildResult } from './release-lib.mjs';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing --${name}.`);
  return process.argv[index + 1];
}

const rootDirectory = path.resolve(import.meta.dirname, '../..');
const easBuildResult = parseEasBuildResult(readFileSync(argument('eas-build-json'), 'utf8'));
const result = await buildReleaseArtifacts({
  rootDirectory,
  tag: argument('tag'),
  commit: argument('commit'),
  imageDigest: argument('image-digest'),
  apkPath: path.resolve(argument('apk')),
  easBuildResult,
  outputDirectory: path.resolve(argument('output-directory')),
  createdAt: argument('created-at'),
  previousStableTag: process.env.PREVIOUS_STABLE_TAG || null,
});
console.log(JSON.stringify({ names: result.names, manifest: result.manifest }, null, 2));
