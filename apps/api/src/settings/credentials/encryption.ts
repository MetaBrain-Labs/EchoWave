/**
 * 数据库 Credential 加密设施。
 *
 * 使用 AES-256-GCM 和绑定租户、Credential、版本及供应商的 AAD 加解密 JSON Credential。
 *
 * Responsibilities:
 * - 为每个版本生成独立随机 IV 和认证标签。
 * - 严格校验解密后的供应商 Credential shape。
 *
 * Notes:
 * - 本模块不负责主密钥读取、持久化或轮换。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import {
  AliyunOssCredentialInputSchema,
  DashScopeCredentialInputSchema,
  DeepSeekCredentialInputSchema,
  type ProviderType,
} from '@echowave/contracts';

import type { CredentialBundle, EncryptedCredential } from '../types.ts';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 1;

function aad(tenantId: string, credentialId: string, version: number, type: ProviderType): Buffer {
  return Buffer.from(`echowave:v1:${tenantId}:${credentialId}:${version}:${type}`, 'utf8');
}

function credentialSchema(type: ProviderType) {
  return type === 'dashscope'
    ? DashScopeCredentialInputSchema
    : type === 'deepseek'
      ? DeepSeekCredentialInputSchema
      : AliyunOssCredentialInputSchema;
}

function maskedValue(bundle: CredentialBundle): string {
  const primary =
    'apiKey' in bundle ? bundle.apiKey : 'accessKeySecret' in bundle ? bundle.accessKeySecret : '';
  return `••••${primary.slice(-4)}`;
}

/** 将供应商 Credential 加密为可持久化的认证密文。 */
export function encryptCredential(input: {
  masterKey: Buffer;
  tenantId: string;
  credentialId: string;
  version: number;
  type: ProviderType;
  bundle: CredentialBundle;
}): EncryptedCredential {
  if (input.masterKey.byteLength !== 32) throw new Error('Credential master key must be 32 bytes.');
  const bundle = credentialSchema(input.type).parse(input.bundle);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, input.masterKey, iv, { authTagLength: 16 });
  cipher.setAAD(aad(input.tenantId, input.credentialId, input.version, input.type));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(bundle), 'utf8'), cipher.final()]);
  return {
    ciphertext,
    iv,
    authTag: cipher.getAuthTag(),
    keyVersion: KEY_VERSION,
    maskedValue: maskedValue(bundle),
  };
}

/** 解密并重新校验一个数据库 Credential 版本。 */
export function decryptCredential(input: {
  masterKey: Buffer;
  tenantId: string;
  credentialId: string;
  version: number;
  type: ProviderType;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}): CredentialBundle {
  if (input.keyVersion !== KEY_VERSION) {
    throw new Error(`Unsupported Credential key version: ${input.keyVersion}`);
  }
  const decipher = createDecipheriv(ALGORITHM, input.masterKey, input.iv, { authTagLength: 16 });
  decipher.setAAD(aad(input.tenantId, input.credentialId, input.version, input.type));
  decipher.setAuthTag(input.authTag);
  const plaintext = Buffer.concat([decipher.update(input.ciphertext), decipher.final()]);
  try {
    return credentialSchema(input.type).parse(JSON.parse(plaintext.toString('utf8')));
  } finally {
    plaintext.fill(0);
  }
}
