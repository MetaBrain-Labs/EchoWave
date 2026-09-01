/**
 * LocalCredentialProvider 严格解析和热重载测试。
 *
 * 验证有效 alias、非法 YAML、类型隔离与最后有效快照行为。
 */
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { LocalCredentialProvider } from '../../dist/settings/credentials/localCredentialProvider.js';

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function fixture(contents) {
  const directory = await mkdtemp(path.join(tmpdir(), 'echowave-credentials-'));
  directories.push(directory);
  const file = path.join(directory, 'credentials.yaml');
  await writeFile(file, contents, { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(file, 0o600);
  return file;
}

describe('LocalCredentialProvider', () => {
  it('returns descriptors without exposing values and resolves matching aliases', async () => {
    const file = await fixture(
      `version: 1\ncredentials:\n  deepseek-main:\n    type: deepseek\n    apiKey: sk-local-secret\n`,
    );
    const provider = new LocalCredentialProvider(file);

    const status = await provider.status();
    assert.equal(status.healthy, true);
    assert.deepEqual(status.credentials, [
      { alias: 'deepseek-main', type: 'deepseek', available: true },
    ]);
    assert.deepEqual(await provider.listDescriptors(), [
      { source: 'local_file', configured: true, alias: 'deepseek-main', maskedValue: null },
    ]);
    assert.equal(JSON.stringify(status).includes('sk-local-secret'), false);
    assert.deepEqual(
      await provider.resolve({ source: 'local_file', alias: 'deepseek-main' }, 'deepseek'),
      { apiKey: 'sk-local-secret' },
    );
    await assert.rejects(() =>
      provider.resolve({ source: 'local_file', alias: 'deepseek-main' }, 'dashscope'),
    );
  });

  it('keeps the last valid snapshot when a reload is invalid', async () => {
    const file = await fixture(
      `version: 1\ncredentials:\n  deepseek-main:\n    type: deepseek\n    apiKey: sk-before\n`,
    );
    const provider = new LocalCredentialProvider(file);
    await provider.status();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(file, 'version: 1\ncredentials: [invalid]\n', { mode: 0o600 });

    const status = await provider.status();
    assert.equal(status.healthy, false);
    await assert.rejects(() => provider.assertAvailableForBinding('deepseek-main', 'deepseek'));
    assert.deepEqual(
      await provider.resolve({ source: 'local_file', alias: 'deepseek-main' }, 'deepseek'),
      { apiKey: 'sk-before' },
    );
  });

  it('treats an existing alias as immutable while accepting a new rotation alias', async () => {
    const file = await fixture(
      `version: 1\ncredentials:\n  deepseek-v1:\n    type: deepseek\n    apiKey: sk-v1\n`,
    );
    const provider = new LocalCredentialProvider(file);
    await provider.status();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(
      file,
      `version: 1\ncredentials:\n  deepseek-v1:\n    type: deepseek\n    apiKey: sk-v1\n  deepseek-v2:\n    type: deepseek\n    apiKey: sk-v2\n`,
      { mode: 0o600 },
    );
    assert.equal((await provider.status()).healthy, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(
      file,
      `version: 1\ncredentials:\n  deepseek-v1:\n    type: deepseek\n    apiKey: overwritten\n  deepseek-v2:\n    type: deepseek\n    apiKey: sk-v2\n`,
      { mode: 0o600 },
    );
    assert.equal((await provider.status()).healthy, false);
    assert.deepEqual(
      await provider.resolve({ source: 'local_file', alias: 'deepseek-v1' }, 'deepseek'),
      { apiKey: 'sk-v1' },
    );
  });

  it('rejects YAML aliases and unknown fields', async () => {
    for (const contents of [
      `version: 1\ncredentials:\n  base: &base\n    type: deepseek\n    apiKey: secret\n  copy: *base\n`,
      `version: 1\ncredentials:\n  deepseek-main:\n    type: deepseek\n    apiKey: secret\n    extra: nope\n`,
    ]) {
      const file = await fixture(contents);
      const provider = new LocalCredentialProvider(file);
      assert.equal((await provider.status()).healthy, false);
    }
  });

  it('rejects duplicate keys, oversized files, missing aliases and broad POSIX permissions', async () => {
    const duplicate = await fixture(
      `version: 1\ncredentials:\n  same:\n    type: deepseek\n    apiKey: one\n  same:\n    type: deepseek\n    apiKey: two\n`,
    );
    assert.equal((await new LocalCredentialProvider(duplicate).status()).healthy, false);

    const oversized = await fixture(
      `version: 1\ncredentials:\n  deepseek-main:\n    type: deepseek\n    apiKey: ${'x'.repeat(70 * 1024)}\n`,
    );
    assert.equal((await new LocalCredentialProvider(oversized).status()).healthy, false);

    const valid = await fixture(
      `version: 1\ncredentials:\n  deepseek-main:\n    type: deepseek\n    apiKey: secret\n`,
    );
    const provider = new LocalCredentialProvider(valid);
    await assert.rejects(() =>
      provider.resolve({ source: 'local_file', alias: 'missing' }, 'deepseek'),
    );
    if (process.platform !== 'win32') {
      await chmod(valid, 0o644);
      assert.equal((await new LocalCredentialProvider(valid).status()).healthy, false);
    }
  });
});
