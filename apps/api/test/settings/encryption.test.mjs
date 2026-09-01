/**
 * 数据库 Credential 加密回归测试。
 *
 * 验证 AES-GCM 的随机性、AAD 绑定和篡改检测。
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  decryptCredential,
  encryptCredential,
} from '../../dist/settings/credentials/encryption.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const credentialId = '22222222-2222-4222-8222-222222222222';
const masterKey = randomBytes(32);
const bundle = { apiKey: 'sk-secret-value' };

describe('Credential encryption', () => {
  it('round-trips a provider Credential without deterministic ciphertext', () => {
    const first = encryptCredential({
      masterKey,
      tenantId,
      credentialId,
      version: 1,
      type: 'deepseek',
      bundle,
    });
    const second = encryptCredential({
      masterKey,
      tenantId,
      credentialId,
      version: 1,
      type: 'deepseek',
      bundle,
    });

    assert.notDeepEqual(first.iv, second.iv);
    assert.equal(first.maskedValue, '••••alue');
    assert.deepEqual(
      decryptCredential({
        masterKey,
        tenantId,
        credentialId,
        version: 1,
        type: 'deepseek',
        ...first,
      }),
      bundle,
    );
  });

  it('rejects ciphertext, key, version and AAD tampering', () => {
    const encrypted = encryptCredential({
      masterKey,
      tenantId,
      credentialId,
      version: 1,
      type: 'deepseek',
      bundle,
    });
    const attempts = [
      { masterKey: randomBytes(32) },
      { tenantId: '33333333-3333-4333-8333-333333333333' },
      { version: 2 },
      {
        ciphertext: Buffer.from(
          encrypted.ciphertext.map((value, index) => value ^ (index === 0 ? 1 : 0)),
        ),
      },
    ];
    for (const change of attempts) {
      assert.throws(() =>
        decryptCredential({
          masterKey,
          tenantId,
          credentialId,
          version: 1,
          type: 'deepseek',
          ...encrypted,
          ...change,
        }),
      );
    }
  });
});
