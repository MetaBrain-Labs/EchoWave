/**
 * Release 容器架构校验入口。
 *
 * 验证 Buildx 推送的 OCI manifest 同时提供 EchoWave 承诺的 amd64 与 arm64 镜像。
 */
import { readFileSync } from 'node:fs';

import { validateImageManifest } from './release-lib.mjs';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node verify-image-manifest.mjs <oci-manifest.json>');
const platforms = validateImageManifest(readFileSync(inputPath, 'utf8'));
console.log(`Container platforms verified: ${platforms.join(', ')}`);
