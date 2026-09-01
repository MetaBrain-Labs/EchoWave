/**
 * PostgreSQL 加密 Credential Provider。
 *
 * 按不可变版本查询密文并通过 AES-GCM 解密，不缓存明文或向上层暴露持久化细节。
 *
 * Responsibilities:
 * - 校验引用来源和供应商类型。
 * - 将认证失败统一视为配置不可用。
 *
 * Notes:
 * - 明文只作为当前供应商调用所需的短生命周期对象返回。
 */
import type { ProviderType } from '@echowave/contracts';

import type { SettingsRepository } from '../repository.ts';
import type { CredentialBundle, CredentialReference } from '../types.ts';
import { SettingsError } from '../types.ts';
import { decryptCredential } from './encryption.ts';

/** 从 PostgreSQL Credential 版本解析供应商密钥。 */
export class DatabaseCredentialProvider {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly tenantId: string,
    private readonly masterKey: Buffer,
  ) {}

  /** 返回数据库 Credential 的脱敏配置状态，不解密任何版本。 */
  async listDescriptors() {
    const providers = await this.repository.listProviders();
    return providers
      .filter((provider) => provider.credential.source === 'database')
      .map((provider) => ({
        source: 'database' as const,
        configured: provider.credential.configured,
        alias: null,
        maskedValue: provider.credential.maskedValue,
      }));
  }

  async resolve(
    reference: CredentialReference,
    expectedType: ProviderType,
  ): Promise<CredentialBundle> {
    if (reference.source !== 'database') {
      throw new SettingsError('BAD_REQUEST', 'DatabaseCredentialProvider 只能解析数据库引用。');
    }
    const row = await this.repository.getCredentialVersion(reference.credentialVersionId);
    if (row.provider_type !== expectedType) {
      throw new SettingsError('CONFIGURATION_REQUIRED', '数据库 Credential 类型不匹配。');
    }
    try {
      return decryptCredential({
        masterKey: this.masterKey,
        tenantId: this.tenantId,
        credentialId: row.credential_id,
        version: row.version_no,
        type: row.provider_type,
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
        keyVersion: row.key_version,
      });
    } catch {
      throw new SettingsError('CONFIGURATION_REQUIRED', '数据库 Credential 无法解密。');
    }
  }
}
