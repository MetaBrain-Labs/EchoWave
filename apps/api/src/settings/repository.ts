/**
 * 租户 AI 配置 PostgreSQL Repository。
 *
 * 管理供应商连接、不可变 revision、加密 Credential 版本、能力绑定和 legacy 导入标记。
 *
 * Responsibilities:
 * - 所有读写强制限定在固定租户。
 * - 在单事务内发布新 revision 与当前指针。
 *
 * Notes:
 * - Credential 加解密和供应商兼容性校验由上层服务负责。
 */
import {
  CapabilityBindingSchema,
  ProviderConnectionSchema,
  type AiCapability,
  type CapabilityBinding,
  type ProviderConnection,
  type ProviderType,
} from '@echowave/contracts';
import type pg from 'pg';

import { quoteIdentifier, type DatabasePool } from '../infrastructure/postgres.ts';
import type { EncryptedCredential } from './types.ts';
import { SettingsError } from './types.ts';

type ProviderRow = {
  id: string;
  provider_type: ProviderType;
  name: string;
  revision_no: number;
  config: unknown;
  credential_source: 'database' | 'local_file';
  credential_version_id: string | null;
  local_credential_alias: string | null;
  masked_value: string | null;
  credential_id: string | null;
  credential_version_no: number | null;
  updated_at: Date;
};

export type StoredProvider = ProviderConnection & {
  credentialVersionId: string | null;
  credentialId: string | null;
  credentialVersion: number | null;
};

export type ProviderWriteRecord = {
  connectionId: string;
  providerRevisionId: string;
  credentialId?: string;
  credentialVersionId?: string;
  credentialVersion?: number;
  type: ProviderType;
  name: string;
  config: unknown;
  credentialSource: 'database' | 'local_file';
  localCredentialAlias?: string;
  encryptedCredential?: EncryptedCredential;
};

export type ResolvedCapabilityRecord = {
  revisionId: string;
  model: string;
  settings: Record<string, unknown>;
  provider: {
    type: ProviderType;
    config: unknown;
    reference:
      { source: 'database'; credentialVersionId: string } | { source: 'local_file'; alias: string };
  };
};

function provider(row: ProviderRow): StoredProvider {
  return {
    ...ProviderConnectionSchema.parse({
      id: row.id,
      type: row.provider_type,
      name: row.name,
      revision: row.revision_no,
      config: row.config,
      credential: {
        source: row.credential_source,
        configured: Boolean(row.credential_version_id || row.local_credential_alias),
        alias: row.local_credential_alias,
        maskedValue: row.masked_value,
      },
      updatedAt: row.updated_at.toISOString(),
    }),
    credentialVersionId: row.credential_version_id,
    credentialId: row.credential_id,
    credentialVersion: row.credential_version_no,
  };
}

/** 为固定租户实现 AI 配置持久化。 */
export class SettingsRepository {
  private readonly schema: string;

  constructor(
    private readonly pool: DatabasePool,
    schema: string,
    private readonly tenantId: string,
  ) {
    this.schema = quoteIdentifier(schema);
  }

  private table(name: string): string {
    return `${this.schema}.${quoteIdentifier(name)}`;
  }

  async listProviders(): Promise<StoredProvider[]> {
    const result = await this.pool.query<ProviderRow>(this.providerQuery(), [this.tenantId]);
    return result.rows.map(provider);
  }

  async getProvider(id: string): Promise<StoredProvider> {
    const result = await this.pool.query<ProviderRow>(`${this.providerQuery()} AND pc.id = $2`, [
      this.tenantId,
      id,
    ]);
    const row = result.rows[0];
    if (!row) throw new SettingsError('NOT_FOUND', '供应商连接不存在。');
    return provider(row);
  }

  async createProvider(record: ProviderWriteRecord): Promise<StoredProvider> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.insertCredential(client, record);
      await client.query(
        `INSERT INTO ${this.table('provider_connections')}
           (id, tenant_id, provider_type, name)
         VALUES ($1, $2, $3, $4)`,
        [record.connectionId, this.tenantId, record.type, record.name],
      );
      await this.insertProviderRevision(client, record, 1);
      await client.query(
        `UPDATE ${this.table('provider_connections')}
         SET current_revision_id = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, record.connectionId, record.providerRevisionId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.getProvider(record.connectionId);
  }

  async updateProvider(
    id: string,
    expectedRevision: number,
    record: ProviderWriteRecord,
  ): Promise<StoredProvider> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ revision_no: number; provider_type: ProviderType }>(
        `SELECT revision.revision_no, pc.provider_type
         FROM ${this.table('provider_connections')} pc
         JOIN ${this.table('provider_connection_revisions')} revision
           ON revision.tenant_id = pc.tenant_id AND revision.id = pc.current_revision_id
         WHERE pc.tenant_id = $1 AND pc.id = $2
         FOR UPDATE OF pc`,
        [this.tenantId, id],
      );
      const current = locked.rows[0];
      if (!current) throw new SettingsError('NOT_FOUND', '供应商连接不存在。');
      if (current.provider_type !== record.type) {
        throw new SettingsError('BAD_REQUEST', '供应商连接类型不可修改。');
      }
      if (current.revision_no !== expectedRevision) {
        throw new SettingsError('CONFLICT', '配置已被修改，请刷新后重试。');
      }
      await this.insertCredential(client, record);
      await client.query(
        `UPDATE ${this.table('provider_connections')}
         SET name = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id, record.name],
      );
      await this.insertProviderRevision(client, record, expectedRevision + 1);
      await this.revisionBindingsForProvider(client, id, record.providerRevisionId);
      await client.query(
        `UPDATE ${this.table('provider_connections')}
         SET current_revision_id = $3
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id, record.providerRevisionId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.getProvider(id);
  }

  async listBindings(): Promise<CapabilityBinding[]> {
    const result = await this.pool.query<{
      capability: AiCapability;
      revision_no: number;
      provider_connection_id: string | null;
      secondary_provider_connection_id: string | null;
      model: string;
      settings: unknown;
      updated_at: Date;
    }>(
      `SELECT binding.capability, revision.revision_no,
              primary_revision.provider_connection_id,
              secondary_revision.provider_connection_id AS secondary_provider_connection_id,
              revision.model, revision.settings, binding.updated_at
       FROM ${this.table('ai_capability_bindings')} binding
       JOIN ${this.table('ai_capability_binding_revisions')} revision
         ON revision.tenant_id = binding.tenant_id AND revision.id = binding.current_revision_id
       LEFT JOIN ${this.table('provider_connection_revisions')} primary_revision
         ON primary_revision.tenant_id = revision.tenant_id
        AND primary_revision.id = revision.provider_revision_id
       LEFT JOIN ${this.table('provider_connection_revisions')} secondary_revision
         ON secondary_revision.tenant_id = revision.tenant_id
        AND secondary_revision.id = revision.secondary_provider_revision_id
       WHERE binding.tenant_id = $1
       ORDER BY binding.capability`,
      [this.tenantId],
    );
    return result.rows.map((row) =>
      CapabilityBindingSchema.parse({
        capability: row.capability,
        providerConnectionId: row.provider_connection_id,
        secondaryProviderConnectionId: row.secondary_provider_connection_id,
        model: row.model,
        settings: row.settings,
        revision: row.revision_no,
        updatedAt: row.updated_at.toISOString(),
      }),
    );
  }

  async saveBinding(input: {
    bindingId: string;
    bindingRevisionId: string;
    capability: AiCapability;
    providerConnectionId: string | null;
    secondaryProviderConnectionId: string | null;
    model: string;
    settings: Record<string, unknown>;
    expectedRevision?: number;
  }): Promise<CapabilityBinding> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; revision_no: number }>(
        `SELECT binding.id, revision.revision_no
         FROM ${this.table('ai_capability_bindings')} binding
         JOIN ${this.table('ai_capability_binding_revisions')} revision
           ON revision.tenant_id = binding.tenant_id AND revision.id = binding.current_revision_id
         WHERE binding.tenant_id = $1 AND binding.capability = $2
         FOR UPDATE OF binding`,
        [this.tenantId, input.capability],
      );
      const current = existing.rows[0];
      if (current && input.expectedRevision !== current.revision_no) {
        throw new SettingsError('CONFLICT', '能力配置已被修改，请刷新后重试。');
      }
      if (!current && input.expectedRevision !== undefined) {
        throw new SettingsError('CONFLICT', '能力配置不存在，请刷新后重试。');
      }
      const bindingId = current?.id ?? input.bindingId;
      if (!current) {
        await client.query(
          `INSERT INTO ${this.table('ai_capability_bindings')}
             (id, tenant_id, capability)
           VALUES ($1, $2, $3)`,
          [bindingId, this.tenantId, input.capability],
        );
      }
      const providerRevisionId = await this.currentProviderRevision(
        client,
        input.providerConnectionId,
      );
      const secondaryProviderRevisionId = await this.currentProviderRevision(
        client,
        input.secondaryProviderConnectionId,
      );
      await client.query(
        `INSERT INTO ${this.table('ai_capability_binding_revisions')}
           (id, tenant_id, binding_id, revision_no, provider_revision_id,
            secondary_provider_revision_id, model, settings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          input.bindingRevisionId,
          this.tenantId,
          bindingId,
          (current?.revision_no ?? 0) + 1,
          providerRevisionId,
          secondaryProviderRevisionId,
          input.model,
          JSON.stringify(input.settings),
        ],
      );
      await client.query(
        `UPDATE ${this.table('ai_capability_bindings')}
         SET current_revision_id = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, bindingId, input.bindingRevisionId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const binding = (await this.listBindings()).find(
      (candidate) => candidate.capability === input.capability,
    );
    if (!binding) throw new Error('Capability binding was not published.');
    return binding;
  }

  async getCredentialVersion(id: string) {
    const result = await this.pool.query<{
      credential_id: string;
      version_no: number;
      provider_type: ProviderType;
      ciphertext: Buffer;
      iv: Buffer;
      auth_tag: Buffer;
      key_version: number;
    }>(
      `SELECT version.credential_id, version.version_no, credential.provider_type,
              version.ciphertext, version.iv, version.auth_tag, version.key_version
       FROM ${this.table('credential_versions')} version
       JOIN ${this.table('credentials')} credential
         ON credential.tenant_id = version.tenant_id AND credential.id = version.credential_id
       WHERE version.tenant_id = $1 AND version.id = $2`,
      [this.tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw new SettingsError('CONFIGURATION_REQUIRED', '数据库 Credential 不存在。');
    return row;
  }

  /** 读取当前或历史能力 revision 及其精确 Provider/Credential 引用。 */
  async resolveCapability(
    capability: AiCapability,
    revisionId?: string,
  ): Promise<ResolvedCapabilityRecord | undefined> {
    const result = await this.pool.query<{
      binding_revision_id: string;
      model: string;
      settings: Record<string, unknown>;
      provider_type: ProviderType;
      config: unknown;
      credential_source: 'database' | 'local_file';
      credential_version_id: string | null;
      local_credential_alias: string | null;
    }>(
      `SELECT revision.id AS binding_revision_id, revision.model, revision.settings,
              connection.provider_type, provider_revision.config,
              provider_revision.credential_source,
              provider_revision.credential_version_id,
              provider_revision.local_credential_alias
       FROM ${this.table('ai_capability_bindings')} binding
       JOIN ${this.table('ai_capability_binding_revisions')} revision
         ON revision.tenant_id = binding.tenant_id
        AND revision.binding_id = binding.id
        AND revision.id = coalesce($3::uuid, binding.current_revision_id)
       JOIN ${this.table('provider_connection_revisions')} provider_revision
         ON provider_revision.tenant_id = revision.tenant_id
        AND provider_revision.id = revision.provider_revision_id
       JOIN ${this.table('provider_connections')} connection
         ON connection.tenant_id = provider_revision.tenant_id
        AND connection.id = provider_revision.provider_connection_id
       WHERE binding.tenant_id = $1 AND binding.capability = $2`,
      [this.tenantId, capability, revisionId ?? null],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const reference =
      row.credential_source === 'database'
        ? { source: 'database' as const, credentialVersionId: row.credential_version_id! }
        : { source: 'local_file' as const, alias: row.local_credential_alias! };
    return {
      revisionId: row.binding_revision_id,
      model: row.model,
      settings: row.settings,
      provider: {
        type: row.provider_type,
        config: row.config,
        reference,
      },
    };
  }

  async importedAt(): Promise<string | null> {
    const result = await this.pool.query<{ imported_at: Date }>(
      `SELECT imported_at FROM ${this.table('configuration_imports')}
       WHERE tenant_id = $1 AND source = 'legacy_env'`,
      [this.tenantId],
    );
    return result.rows[0]?.imported_at.toISOString() ?? null;
  }

  async markLegacyImported(): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table('configuration_imports')} (tenant_id, source)
       VALUES ($1, 'legacy_env') ON CONFLICT (tenant_id, source) DO NOTHING`,
      [this.tenantId],
    );
  }

  private providerQuery(): string {
    return `SELECT pc.id, pc.provider_type, pc.name, revision.revision_no, revision.config,
                   revision.credential_source, revision.credential_version_id,
                   revision.local_credential_alias, version.masked_value,
                   version.credential_id, version.version_no AS credential_version_no,
                   pc.updated_at
            FROM ${this.table('provider_connections')} pc
            JOIN ${this.table('provider_connection_revisions')} revision
              ON revision.tenant_id = pc.tenant_id AND revision.id = pc.current_revision_id
            LEFT JOIN ${this.table('credential_versions')} version
              ON version.tenant_id = revision.tenant_id
             AND version.id = revision.credential_version_id
            WHERE pc.tenant_id = $1`;
  }

  private async insertCredential(client: pg.PoolClient, record: ProviderWriteRecord) {
    if (!record.encryptedCredential) return;
    await client.query(
      `INSERT INTO ${this.table('credentials')}
         (id, tenant_id, provider_type, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [record.credentialId, this.tenantId, record.type, record.name],
    );
    const encrypted = record.encryptedCredential;
    await client.query(
      `INSERT INTO ${this.table('credential_versions')}
         (id, tenant_id, credential_id, version_no, ciphertext, iv, auth_tag,
          key_version, masked_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        record.credentialVersionId,
        this.tenantId,
        record.credentialId,
        record.credentialVersion,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        encrypted.keyVersion,
        encrypted.maskedValue,
      ],
    );
  }

  private async insertProviderRevision(
    client: pg.PoolClient,
    record: ProviderWriteRecord,
    revision: number,
  ) {
    await client.query(
      `INSERT INTO ${this.table('provider_connection_revisions')}
         (id, tenant_id, provider_connection_id, revision_no, config, credential_source,
          credential_version_id, local_credential_alias)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        record.providerRevisionId,
        this.tenantId,
        record.connectionId,
        revision,
        JSON.stringify(record.config),
        record.credentialSource,
        record.credentialVersionId ?? null,
        record.localCredentialAlias ?? null,
      ],
    );
  }

  private async currentProviderRevision(client: pg.PoolClient, id: string | null) {
    if (!id) return null;
    const result = await client.query<{ current_revision_id: string }>(
      `SELECT current_revision_id FROM ${this.table('provider_connections')}
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, id],
    );
    if (!result.rows[0]?.current_revision_id) {
      throw new SettingsError('NOT_FOUND', '能力绑定引用的供应商连接不存在。');
    }
    return result.rows[0].current_revision_id;
  }

  private async revisionBindingsForProvider(
    client: pg.PoolClient,
    connectionId: string,
    providerRevisionId: string,
  ) {
    const bindings = await client.query<{
      binding_id: string;
      revision_no: number;
      provider_revision_id: string | null;
      secondary_provider_revision_id: string | null;
      primary_connection_id: string | null;
      secondary_connection_id: string | null;
      model: string;
      settings: unknown;
    }>(
      `SELECT binding.id AS binding_id, revision.revision_no,
              revision.provider_revision_id, revision.secondary_provider_revision_id,
              primary_revision.provider_connection_id AS primary_connection_id,
              secondary_revision.provider_connection_id AS secondary_connection_id,
              revision.model, revision.settings
       FROM ${this.table('ai_capability_bindings')} binding
       JOIN ${this.table('ai_capability_binding_revisions')} revision
         ON revision.tenant_id = binding.tenant_id AND revision.id = binding.current_revision_id
       LEFT JOIN ${this.table('provider_connection_revisions')} primary_revision
         ON primary_revision.tenant_id = revision.tenant_id
        AND primary_revision.id = revision.provider_revision_id
       LEFT JOIN ${this.table('provider_connection_revisions')} secondary_revision
         ON secondary_revision.tenant_id = revision.tenant_id
        AND secondary_revision.id = revision.secondary_provider_revision_id
       WHERE binding.tenant_id = $1
         AND ($2 IN (primary_revision.provider_connection_id, secondary_revision.provider_connection_id))
       FOR UPDATE OF binding`,
      [this.tenantId, connectionId],
    );
    for (const binding of bindings.rows) {
      const nextRevisionId = crypto.randomUUID();
      await client.query(
        `INSERT INTO ${this.table('ai_capability_binding_revisions')}
           (id, tenant_id, binding_id, revision_no, provider_revision_id,
            secondary_provider_revision_id, model, settings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          nextRevisionId,
          this.tenantId,
          binding.binding_id,
          binding.revision_no + 1,
          binding.primary_connection_id === connectionId
            ? providerRevisionId
            : binding.provider_revision_id,
          binding.secondary_connection_id === connectionId
            ? providerRevisionId
            : binding.secondary_provider_revision_id,
          binding.model,
          JSON.stringify(binding.settings),
        ],
      );
      await client.query(
        `UPDATE ${this.table('ai_capability_bindings')}
         SET current_revision_id = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, binding.binding_id, nextRevisionId],
      );
    }
  }
}
