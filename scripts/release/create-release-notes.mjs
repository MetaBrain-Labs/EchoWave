/**
 * GitHub Release 说明渲染模块。
 *
 * 把机器可读 manifest 中的版本、镜像、数据库兼容边界与创建时间转换为面向用户的结构化说明：
 * 先给出变更重点、下载入口与影响范围，再把 migration 明细和自动生成的 PR 列表折叠到末尾。
 * 维护者仍可在发布草稿中人工补充重点条目。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 把 ISO 时间戳转换为 Release 说明顶部的发布日期；非法值返回 null。 */
function releaseDate(createdAt) {
  if (typeof createdAt !== 'string' || createdAt.trim() === '') return null;
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function bulletList(items, emptyText) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${emptyText}`;
}

/** 将发布 manifest 与 GitHub changelog 渲染为最终 Release 说明。 */
export function renderReleaseNotes(manifest, generatedNotes) {
  const newMigrations = manifest.database.newMigrations;
  const migrationSummary =
    newMigrations.length > 0 ? newMigrations.map((name) => `\`${name}\``).join('、') : '无';
  const date = releaseDate(manifest.createdAt);
  const changelog = generatedNotes.trim() || '首次自动化发布。';
  const notes = manifest.releaseNotes;
  const releaseChannel = manifest.prerelease ? 'Beta 预发布' : '稳定版';
  return `# EchoWave ${manifest.tag}
${
  date
    ? `\n> 发布日期：${date}
> 发布渠道：${releaseChannel}\n`
    : `\n> 发布渠道：${releaseChannel}\n`
}
## Highlights

${bulletList(notes.highlights, '本次无重点变更。')}

## Downloads

- Android：下载 \`${manifest.assets.android.name}\`。从较新版本降级时，Android 要求先卸载当前 App；这会清除 App 本地偏好，但不会删除服务器数据。
- Server：下载并解压 \`${manifest.assets.server.name}\`，首次安装按压缩包内 README 配置 \`api.env\`。
- 完整性：使用 \`${manifest.tag}\` 对应的 \`${`SHA256SUMS-v${manifest.version}.txt`}\` 校验下载文件。

## What's new

### Audio

${bulletList(notes.changes.Audio, '本次无变化。')}

### Analysis

${bulletList(notes.changes.Analysis, '本次无变化。')}

### Knowledge

${bulletList(notes.changes.Knowledge, '本次无变化。')}

### Deployment

${bulletList(notes.changes.Deployment, '本次无变化。')}

## Breaking changes

${bulletList(notes.breakingChanges, '无。')}

## Known limitations

${bulletList(notes.knownLimitations, '无已知限制。')}

## Upgrade

1. 校验下载文件与 \`SHA256SUMS-v${manifest.version}.txt\`。
2. 升级前必须完成并验证 PostgreSQL 备份。
3. 保留现有 \`api.env\`、\`.data/secrets\`、\`compose.yaml\` 与备份目录。
4. 当前数据库允许直接回退的最低 Server 版本：\`v${manifest.database.minimumDirectRollbackVersion}\`。更早版本必须先恢复升级前备份。
5. 镜像：\`${manifest.image.reference}\`
6. 平台：${manifest.image.platforms.join('、')}

<details>
<summary>Database migrations</summary>

本次新增 migration：${migrationSummary}

</details>

<details>
<summary>Full changelog</summary>

${changelog}

</details>
`;
}

/** 命令行入口：读取 manifest 与自动生成的变更列表，写出最终 Release 说明文件。 */
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
