import fs from 'node:fs';
import path from 'node:path';

const version = process.argv[2];

if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  console.error('Usage: pnpm release:bump <version>');
  console.error('Example: pnpm release:bump 0.2.0');
  process.exit(1);
}

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
  json.expo.version = version;
});

updateJson('deploy/release/release.json', (json) => {
  json.version = version;
});

console.log(`\nEchoWave version bumped to ${version}`);
