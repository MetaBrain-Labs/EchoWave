/**
 * 配置中心启动级安全配置。
 *
 * 校验 Credential 根密钥、管理口令、本地密钥文件和可信反向代理，不读取业务配置。
 *
 * Responsibilities:
 * - 保证数据库 Credential 使用精确的 256 位主密钥。
 * - 解析本地 Credential 文件和可信代理 CIDR 列表。
 *
 * Notes:
 * - 这些值必须在连接数据库和开放管理接口前可用，因此继续保留在 `.env`。
 */
import { z } from 'zod';
import { isIP } from 'node:net';

export const SettingsSecurityEnvironmentSchema = z.object({
  CREDENTIAL_MASTER_KEY: z.string().min(1),
  CONFIGURATION_ADMIN_TOKEN: z.string().min(32),
  LOCAL_CREDENTIALS_FILE: z.string().min(1),
  TRUSTED_PROXY_CIDRS: z.string(),
});

export type SettingsSecurityConfig = {
  credentialMasterKey: Buffer;
  configurationAdminToken: string;
  localCredentialsFile: string;
  trustedProxyCidrs: string[];
};

/** 解析配置中心启动安全配置，并拒绝长度不正确的主密钥。 */
export function createSettingsSecurityConfig(
  values: z.infer<typeof SettingsSecurityEnvironmentSchema>,
): SettingsSecurityConfig {
  const masterKey = Buffer.from(values.CREDENTIAL_MASTER_KEY, 'base64');
  if (
    masterKey.byteLength !== 32 ||
    masterKey.toString('base64') !== values.CREDENTIAL_MASTER_KEY
  ) {
    throw new Error('CREDENTIAL_MASTER_KEY must be a canonical Base64-encoded 32-byte key.');
  }
  const trustedProxyCidrs = values.TRUSTED_PROXY_CIDRS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const cidr of trustedProxyCidrs) {
    const parts = cidr.split('/');
    const family = isIP(parts[0] ?? '');
    const prefix = parts[1] === undefined ? (family === 4 ? 32 : 128) : Number(parts[1]);
    if (
      parts.length > 2 ||
      family === 0 ||
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > (family === 4 ? 32 : 128)
    ) {
      throw new Error(`TRUSTED_PROXY_CIDRS contains an invalid CIDR: ${cidr}`);
    }
  }
  return {
    credentialMasterKey: masterKey,
    configurationAdminToken: values.CONFIGURATION_ADMIN_TOKEN,
    localCredentialsFile: values.LOCAL_CREDENTIALS_FILE,
    trustedProxyCidrs,
  };
}
