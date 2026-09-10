/**
 * GitHub Release 说明生成入口。
 *
 * 把机器可读 manifest 中的版本、镜像和数据库兼容边界转换为用户可执行的下载、升级与
 * 回滚说明，并附加 GitHub 自动生成的变更列表。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 将发布 manifest 与 GitHub changelog 渲染为最终 Release 说明。 */
export function renderReleaseNotes(manifest, generatedNotes) {
  const newMigrations = manifest.database.newMigrations;
  const migrationSummary =
    newMigrations.length > 0 ? newMigrations.map((name) => `\`${name}\``).join('、') : '无';
  return `## 下载与安装

- Android：下载 \`${manifest.assets.android.name}\`。从较新版本降级时，Android 要求先卸载当前 App；这会清除 App 本地偏好，但不会删除服务器数据。
- Server：下载并解压 \`${manifest.assets.server.name}\`，首次安装按压缩包内 README 配置 \`api.env\`。
- 完整性：使用 \`${manifest.tag}\` 对应的 \`${`SHA256SUMS-v${manifest.version}.txt`}\` 校验下载文件。

## Server 版本与回滚

- 镜像：\`${manifest.image.reference}\`
- 平台：${manifest.image.platforms.join('、')}
- 升级前必须完成并验证 PostgreSQL 备份。
- 当前数据库允许直接回退的最低 Server 版本：\`v${manifest.database.minimumDirectRollbackVersion}\`。更早版本必须先恢复升级前备份。
- 本次新增 migration：${migrationSummary}。

> EchoWave 当前仍只适合可信局域网，不要把 API 端口直接暴露到公网。

## 变更

${generatedNotes.trim() || '首次自动化发布。'}
`;
}

function runCli() {
  const [manifestPath, generatedNotesPath, outputPath] = process.argv.slice(2);
  if (!manifestPath || !generatedNotesPath || !outputPath) {
    throw new Error(
      'Usage: node create-release-notes.mjs <manifest.json> <generated-notes.md> <output.md>',
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const generatedNotes = readFileSync(generatedNotesPath, 'utf8');
  writeFileSync(outputPath, renderReleaseNotes(manifest, generatedNotes), 'utf8');
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entryPath === import.meta.url) runCli();
