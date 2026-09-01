/**
 * 服务器本地 YAML Credential Provider。
 *
 * 从显式只读文件加载严格版本化的供应商密钥，并在完整校验成功后原子替换内存快照。
 *
 * Responsibilities:
 * - 拒绝超限、权限过宽、结构异常或包含 YAML 扩展能力的文件。
 * - 在热重载失败时保留最后一次有效快照并暴露健康状态。
 *
 * Notes:
 * - 本模块从不创建、修改或回传本地 Credential 明文。
 */
import { readFile, stat } from 'node:fs/promises';
import process from 'node:process';

import {
  LocalCredentialProviderStatusSchema,
  ProviderTypeSchema,
  type LocalCredentialProviderStatus,
  type ProviderType,
} from '@echowave/contracts';
import { parseDocument } from 'yaml';
import { z } from 'zod';

import type { CredentialBundle, CredentialReference } from '../types.ts';
import { SettingsError } from '../types.ts';

const MAX_FILE_BYTES = 64 * 1024;
const AliasSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/);
const LocalCredentialSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('dashscope'),
      apiKey: z.string().min(1),
      eventBridgeCallbackToken: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ type: z.literal('deepseek'), apiKey: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal('aliyun_oss'),
      accessKeyId: z.string().min(1),
      accessKeySecret: z.string().min(1),
    })
    .strict(),
]);
const LocalCredentialsFileSchema = z
  .object({ version: z.literal(1), credentials: z.record(AliasSchema, LocalCredentialSchema) })
  .strict();

type LocalCredential = z.infer<typeof LocalCredentialSchema>;

function safeMessage(error: unknown): string {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    return '本地 Credential 文件不存在。';
  }
  if (error instanceof Error && error.message.includes('permissions')) return error.message;
  return '本地 Credential 文件无效，请检查 YAML 结构和文件权限。';
}

/** 只读加载并按需热重载一个显式 YAML Credential 文件。 */
export class LocalCredentialProvider {
  private snapshot = new Map<string, LocalCredential>();
  private signature?: string;
  private lastLoadedAt: string | null = null;
  private error: string | null = null;

  constructor(private readonly filePath: string) {}

  /** 返回不含密钥值的本地 Provider 健康状态和 alias 目录。 */
  async status(): Promise<LocalCredentialProviderStatus> {
    await this.refresh();
    return LocalCredentialProviderStatusSchema.parse({
      configured: Boolean(this.filePath),
      healthy: this.error === null,
      lastLoadedAt: this.lastLoadedAt,
      error: this.error,
      credentials: [...this.snapshot.entries()].map(([alias, value]) => ({
        alias,
        type: value.type,
        available: this.error === null,
      })),
    });
  }

  /** 返回统一 Provider 端口要求的脱敏 alias 描述。 */
  async listDescriptors() {
    const status = await this.status();
    return status.credentials.map((item) => ({
      source: 'local_file' as const,
      configured: item.available,
      alias: item.alias,
      maskedValue: null,
    }));
  }

  /** 新连接只能绑定到当前健康快照，避免文件损坏后继续扩大故障范围。 */
  async assertAvailableForBinding(alias: string, expectedType: ProviderType): Promise<void> {
    const status = await this.status();
    if (!status.healthy) {
      throw new SettingsError(
        'CONFIGURATION_REQUIRED',
        '本地 Credential 文件当前异常，不能创建新绑定。',
      );
    }
    await this.resolve({ source: 'local_file', alias }, expectedType);
  }

  /** 解析指定 alias；调用方只能取得与预期供应商类型一致的密钥包。 */
  async resolve(
    reference: CredentialReference,
    expectedType: ProviderType,
  ): Promise<CredentialBundle> {
    if (reference.source !== 'local_file') {
      throw new SettingsError('BAD_REQUEST', 'LocalCredentialProvider 只能解析本地引用。');
    }
    await this.refresh();
    const value = this.snapshot.get(reference.alias);
    if (!value || ProviderTypeSchema.parse(value.type) !== expectedType) {
      throw new SettingsError(
        'CONFIGURATION_REQUIRED',
        '本地 Credential alias 不存在或类型不匹配。',
      );
    }
    const { type: _type, ...bundle } = value;
    return bundle;
  }

  private async refresh(): Promise<void> {
    try {
      const details = await stat(this.filePath);
      if (!details.isFile())
        throw new Error('Local Credential path must reference a regular file.');
      if (details.size > MAX_FILE_BYTES) throw new Error('Local Credential file is too large.');
      if (process.platform !== 'win32' && (details.mode & 0o077) !== 0) {
        throw new Error('Local Credential file permissions must not allow group or world access.');
      }
      const signature = `${details.mtimeMs}:${details.size}`;
      if (signature === this.signature) return;
      const raw = await readFile(this.filePath, 'utf8');
      const document = parseDocument(raw, {
        prettyErrors: false,
        schema: 'core',
        uniqueKeys: true,
      });
      if (document.errors.length > 0 || document.warnings.length > 0) {
        throw new Error('Local Credential YAML contains unsupported syntax.');
      }
      const parsed = LocalCredentialsFileSchema.parse(document.toJS({ maxAliasCount: 0 }));
      const nextSnapshot = new Map(Object.entries(parsed.credentials));
      for (const [alias, previous] of this.snapshot) {
        const next = nextSnapshot.get(alias);
        if (next && JSON.stringify(next) !== JSON.stringify(previous)) {
          throw new Error(`Local Credential alias must be immutable: ${alias}`);
        }
      }
      this.snapshot = nextSnapshot;
      this.signature = signature;
      this.lastLoadedAt = new Date().toISOString();
      this.error = null;
    } catch (error) {
      this.error = safeMessage(error);
    }
  }
}
