/**
 * 配置中心内部领域类型。
 *
 * 定义 Credential Provider、持久化 revision 和可稳定映射的配置错误。
 *
 * Responsibilities:
 * - 隔离网络 DTO 与服务端明文 Credential。
 * - 为数据库和本地文件 Provider 提供统一解析端口。
 *
 * Notes:
 * - CredentialBundle 只能短暂存在于 API 运行时内存。
 */
import type { CredentialBundleInput, CredentialSource, ProviderType } from '@echowave/contracts';

export type CredentialBundle = CredentialBundleInput;

export type CredentialReference =
  { source: 'database'; credentialVersionId: string } | { source: 'local_file'; alias: string };

export type CredentialDescriptor = {
  source: CredentialSource;
  configured: boolean;
  alias: string | null;
  maskedValue: string | null;
};

export type CredentialProvider = {
  resolve(reference: CredentialReference, expectedType: ProviderType): Promise<CredentialBundle>;
  listDescriptors(): Promise<CredentialDescriptor[]>;
};

export type EncryptedCredential = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
  maskedValue: string;
};

/** 配置中心可由 HTTP 层安全映射的领域错误。 */
export class SettingsError extends Error {
  constructor(
    public readonly code:
      | 'BAD_REQUEST'
      | 'CONFIGURATION_REQUIRED'
      | 'CONFLICT'
      | 'INSECURE_CREDENTIAL_TRANSPORT'
      | 'NOT_FOUND'
      | 'UNAUTHORIZED',
    message: string,
  ) {
    super(message);
    this.name = 'SettingsError';
  }
}
