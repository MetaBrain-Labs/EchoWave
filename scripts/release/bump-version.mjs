/**
 * EchoWave 版本来源同步脚本。
 *
 * 将稳定版或 Beta 预发布版本写入 workspace package 与发布元数据，同时让 Expo 原生展示
 * 版本保持不含预发布后缀的 MAJOR.MINOR.PATCH。
 */
import fs from 'node:fs';
import path from 'node:path';

const version = process.argv[2];
const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/.exec(
  version ?? '',
);

if (!version || !match) {
  console.error('Usage: pnpm release:bump <version>');
  console.error('Examples: pnpm release:bump 1.0.0 or pnpm release:bump 1.0.0-beta.1');
  process.exit(1);
}
const appVersion = match.slice(1, 4).join('.');

const root = process.cwd();

function updateJson(relativePath, updater) {
  const filePath = path.join(root, relativePath);
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  updater(json);

  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);

  console.log(`✓ ${relativePath}`);
}

const packageFiles = [
  'package.json',
  'apps/api/package.json',
  'apps/mobile/package.json',
  'packages/contracts/package.json',
];

for (const file of packageFiles) {
  updateJson(file, (json) => {
    json.version = version;
  });
}

updateJson('apps/mobile/app.json', (json) => {
  json.expo.version = appVersion;
});

updateJson('deploy/release/release.json', (json) => {
  json.version = version;
  json.appVersion = appVersion;
});

console.log(`\nEchoWave release version bumped to ${version}; native App version is ${appVersion}`);
