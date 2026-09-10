/**
 * EAS Build 结果提取入口。
 *
 * 把 EAS CLI 的 JSON 输出收敛为可供 GitHub Actions 记录的单行字段，并把临时下载地址
 * 仅写入工作区文件，避免它被打印到公开构建日志。
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { appendGitHubOutput, parseEasBuildResult } from './release-lib.mjs';

const [inputPath, artifactUrlPath] = process.argv.slice(2);
if (!inputPath || !artifactUrlPath) {
  throw new Error('Usage: node extract-eas-build.mjs <eas-build.json> <artifact-url-file>');
}
const result = parseEasBuildResult(readFileSync(inputPath, 'utf8'));
writeFileSync(artifactUrlPath, result.artifactUrl, { encoding: 'utf8', mode: 0o600 });
appendGitHubOutput(process.env.GITHUB_OUTPUT, {
  build_id: result.id,
  app_version: result.appVersion,
  app_build_version: result.appBuildVersion,
});
console.log(`EAS build ${result.id} metadata extracted.`);
