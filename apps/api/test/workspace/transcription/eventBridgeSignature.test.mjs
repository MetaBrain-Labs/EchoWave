/**
 * EventBridge HTTP 回调验签测试。
 *
 * 覆盖待签串、重放保护、证书来源限制、Token 校验和公钥缓存。
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  EventBridgeSignatureError,
  EventBridgeSignatureVerifier,
} from '../../../dist/workspace/transcription/eventBridgeSignature.js';

const CALLBACK_URL = 'https://api.example.com/api/webhooks/dashscope/async-task-finished';
const CERTIFICATE_URL =
  'https://cn-beijing-eventbridge.oss-accelerate.aliyuncs.com/certificate.pem';
const TOKEN = 'eventbridge-secret';
const NOW = Date.parse('2026-08-29T00:00:00.000Z');

function signedHeaders(rawBody, privateKey, overrides = {}) {
  const values = {
    timestamp: String(NOW),
    hashMethod: 'SHA256',
    version: '1.0',
    certificateUrl: CERTIFICATE_URL,
    token: TOKEN,
    ...overrides,
  };
  const fixedHeaders = [
    `x-eventbridge-signature-timestamp: ${values.timestamp}`,
    `x-eventbridge-hash-method: ${values.hashMethod}`,
    `x-eventbridge-signature-version: ${values.version}`,
    `x-eventbridge-signature-url: ${values.certificateUrl}`,
    `x-eventbridge-signature-token: ${values.token}`,
  ].join('\n');
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${CALLBACK_URL}\n${fixedHeaders}\n${rawBody}`, 'utf8'),
    privateKey,
  ).toString('base64');
  return new Headers({
    'x-eventbridge-signature-timestamp': values.timestamp,
    'x-eventbridge-hash-method': values.hashMethod,
    'x-eventbridge-signature-version': values.version,
    'x-eventbridge-signature-url': values.certificateUrl,
    'x-eventbridge-signature-token': values.token,
    'x-eventbridge-signature-v2': signature,
  });
}

describe('EventBridgeSignatureVerifier', () => {
  it('verifies the raw body and caches the official certificate key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    let loads = 0;
    const verifier = new EventBridgeSignatureVerifier({
      callbackUrl: CALLBACK_URL,
      token: TOKEN,
      now: () => NOW,
      publicKeyLoader: async () => {
        loads += 1;
        return publicKey;
      },
    });
    const body = '{"event":"completed"}';
    const headers = signedHeaders(body, privateKey);
    await verifier.verify(body, headers);
    await verifier.verify(body, headers);
    assert.equal(loads, 1);
  });

  it('rejects a tampered body, wrong token and stale timestamp', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const verifier = new EventBridgeSignatureVerifier({
      callbackUrl: CALLBACK_URL,
      token: TOKEN,
      now: () => NOW,
      publicKeyLoader: async () => publicKey,
    });
    const body = '{"event":"completed"}';
    await assert.rejects(() => verifier.verify(`${body} `, signedHeaders(body, privateKey)), {
      kind: 'unauthorized',
    });
    await assert.rejects(
      () => verifier.verify(body, signedHeaders(body, privateKey, { token: 'wrong' })),
      { kind: 'unauthorized' },
    );
    await assert.rejects(
      () =>
        verifier.verify(body, signedHeaders(body, privateKey, { timestamp: String(NOW - 60_001) })),
      { kind: 'unauthorized' },
    );
  });

  it('rejects non-official certificate URLs and reports certificate outages as transient', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const body = '{}';
    const verifier = new EventBridgeSignatureVerifier({
      callbackUrl: CALLBACK_URL,
      token: TOKEN,
      now: () => NOW,
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    await assert.rejects(
      () =>
        verifier.verify(
          body,
          signedHeaders(body, privateKey, {
            certificateUrl: 'https://attacker.example.com/certificate.pem',
          }),
        ),
      { kind: 'unauthorized' },
    );
    await assert.rejects(
      () => verifier.verify(body, signedHeaders(body, privateKey)),
      (error) => {
        assert.ok(error instanceof EventBridgeSignatureError);
        assert.equal(error.kind, 'temporary_unavailable');
        return true;
      },
    );
  });

  it('rejects an oversized streamed certificate without trusting content-length', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const body = '{}';
    const verifier = new EventBridgeSignatureVerifier({
      callbackUrl: CALLBACK_URL,
      token: TOKEN,
      now: () => NOW,
      fetchImpl: async () => new Response(Buffer.alloc(64 * 1_024 + 1)),
    });
    await assert.rejects(() => verifier.verify(body, signedHeaders(body, privateKey)), {
      kind: 'unauthorized',
    });
  });
});
