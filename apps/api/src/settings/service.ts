/**
 * 租户 AI 配置应用服务。
 *
 * 编排供应商连接、双 Credential Provider、能力绑定、legacy 导入和管理口令校验。
 *
 * Responsibilities:
 * - 在持久化前校验供应商类型、模型、出站地址和传输安全。
 * - 创建不可变 Provider/Credential revision 并返回完全脱敏的管理视图。
 *
 * Notes:
 * - 路由负责提取真实连接信息；本服务不信任客户端提交的安全状态。
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';

import {
  AI_CAPABILITY_DEFAULTS,
  AI_CAPABILITY_PROVIDER_PREFERENCES,
  AliyunOssCredentialInputSchema,
  CAPABILITY_MODEL_REQUIREMENTS,
  CapabilityBindingWriteSchema,
  DashScopeCredentialInputSchema,
  DeepSeekCredentialInputSchema,
  EMBEDDING_DIMENSIONS,
  ModelCatalogQuerySchema,
  ProviderConnectionSchema,
  ProviderConnectionWriteSchema,
  SettingsOverviewSchema,
  supportsThinkingSetting,
  type AiCapability,
  type CapabilityBindingWrite,
  type CredentialBundleInput,
  type ModelCatalogQuery,
  type ModelCatalogResponse,
  type ProviderConnection,
  type ProviderConnectionWrite,
  type ProviderType,
  type SettingsOverview,
} from '@echowave/contracts';
import { z } from 'zod';

import type { DatabaseCredentialProvider } from './credentials/databaseCredentialProvider.ts';
import { encryptCredential } from './credentials/encryption.ts';
import type { LocalCredentialProvider } from './credentials/localCredentialProvider.ts';
import { ModelCatalogService, type CatalogProviderInput } from './modelCatalog.ts';
import type { SettingsRepository, StoredProvider } from './repository.ts';
import { isPrivateNetworkAddress, type TransportSecurity } from './transportSecurity.ts';
import type { CredentialBundle, CredentialReference } from './types.ts';
import { SettingsError } from './types.ts';

const ThinkingSettingsSchema = z.object({ enableThinking: z.boolean() }).strict();
const EmptySettingsSchema = z.object({}).strict();

export type LegacyAiConfiguration = {
  detectedVariables: string[];
  missingVariables: string[];
  dashScope?: {
    config: ProviderConnectionWrite['config'];
    credential: CredentialBundleInput;
  };
  deepSeek?: {
    config: ProviderConnectionWrite['config'];
    credential: CredentialBundleInput;
    enableThinking: boolean;
  };
  oss?: {
    config: ProviderConnectionWrite['config'];
    credential: CredentialBundleInput;
  };
};

export type ResolvedCapability = {
  revisionId: string | null;
  model: string;
  settings: Record<string, unknown>;
  provider: {
    type: ProviderType;
    config: ProviderConnectionWrite['config'];
    credential: CredentialBundle;
  };
};

function publicProvider(value: StoredProvider): ProviderConnection {
  return ProviderConnectionSchema.parse({
    id: value.id,
    type: value.type,
    name: value.name,
    revision: value.revision,
    config: value.config,
    credential: value.credential,
    updatedAt: value.updatedAt,
  });
}

function credentialSchema(type: ProviderType) {
  return type === 'dashscope'
    ? DashScopeCredentialInputSchema
    : type === 'deepseek'
      ? DeepSeekCredentialInputSchema
      : AliyunOssCredentialInputSchema;
}

function validSettings(capability: AiCapability, value: Record<string, unknown>) {
  return supportsThinkingSetting(capability)
    ? ThinkingSettingsSchema.parse(value)
    : EmptySettingsSchema.parse(value);
}

/** 当前租户配置中心的应用编排入口。 */
export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly databaseCredentials: DatabaseCredentialProvider,
    private readonly localCredentials: LocalCredentialProvider,
    private readonly tenantId: string,
    private readonly masterKey: Buffer,
    private readonly adminToken: string,
    private readonly legacy: LegacyAiConfiguration,
    private readonly modelCatalog = new ModelCatalogService(),
  ) {}

  /** 使用定时安全比较校验管理口令。 */
  authorize(value: string | undefined): void {
    const prefix = 'Bearer ';
    const supplied = value?.startsWith(prefix) ? value.slice(prefix.length) : '';
    const expectedBuffer = Buffer.from(this.adminToken);
    const suppliedBuffer = Buffer.from(supplied);
    if (
      suppliedBuffer.byteLength !== expectedBuffer.byteLength ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new SettingsError('UNAUTHORIZED', '管理口令无效。');
    }
  }

  /** 返回脱敏的配置中心权威状态。 */
  async overview(transport: TransportSecurity): Promise<SettingsOverview> {
    const [providers, bindings, localCredentials, importedAt] = await Promise.all([
      this.repository.listProviders(),
      this.repository.listBindings(),
      this.localCredentials.status(),
      this.repository.importedAt(),
    ]);
    return SettingsOverviewSchema.parse({
      transport,
      localCredentials,
      providers: providers.map(publicProvider),
      bindings,
      legacy: {
        detectedVariables: [...this.legacy.detectedVariables].sort(),
        missingVariables: [...this.legacy.missingVariables].sort(),
        ready:
          this.legacy.missingVariables.length === 0 &&
          Boolean(this.legacy.dashScope && this.legacy.deepSeek),
        importedAt,
      },
    });
  }

  /** 创建供应商连接；远程 HTTP 永远不能携带数据库 Secret。 */
  async createProvider(
    rawInput: ProviderConnectionWrite,
    transport: TransportSecurity,
  ): Promise<ProviderConnection> {
    const input = ProviderConnectionWriteSchema.parse(rawInput);
    await this.validateProviderInput(input, transport, true);
    const record = await this.providerRecord(input);
    return publicProvider(await this.repository.createProvider(record));
  }

  /** 通过期望 revision 更新连接并发布新的不可变版本。 */
  async updateProvider(
    id: string,
    rawInput: ProviderConnectionWrite,
    transport: TransportSecurity,
  ): Promise<ProviderConnection> {
    const input = ProviderConnectionWriteSchema.parse(rawInput);
    if (!input.expectedRevision) {
      throw new SettingsError('BAD_REQUEST', '更新连接必须提供 expectedRevision。');
    }
    const current = await this.repository.getProvider(id);
    await this.validateProviderInput(input, transport, false, current);
    const record = await this.providerRecord(input, current);
    record.connectionId = id;
    return publicProvider(await this.repository.updateProvider(id, input.expectedRevision, record));
  }

  /** 保存一个受支持能力的当前绑定，并按能力责任校验所选模型。 */
  async saveBinding(capability: AiCapability, rawInput: CapabilityBindingWrite) {
    const input = CapabilityBindingWriteSchema.parse(rawInput);
    const requirement = CAPABILITY_MODEL_REQUIREMENTS[capability];
    if (requirement.fixedModel && input.model !== AI_CAPABILITY_DEFAULTS[capability].model) {
      // 固定能力（音频中转与权威对象存储）没有可选模型，避免写入无法解析的后端标识。
      throw new SettingsError('BAD_REQUEST', '该能力不支持所选模型。');
    }
    const settings = validSettings(capability, input.settings);
    if (!input.providerConnectionId) {
      throw new SettingsError('BAD_REQUEST', '能力必须选择供应商连接。');
    }
    if (input.secondaryProviderConnectionId) {
      throw new SettingsError('BAD_REQUEST', '当前能力不支持第二供应商连接。');
    }
    const provider = await this.repository.getProvider(input.providerConnectionId);
    if (!(requirement.providers as readonly ProviderType[]).includes(provider.type)) {
      throw new SettingsError('BAD_REQUEST', '供应商连接类型与能力不兼容。');
    }
    if (!requirement.fixedModel) {
      const current = (await this.repository.listBindings()).find(
        (binding) => binding.capability === capability,
      );
      const credential = await this.resolveCredential(provider);
      const catalogProvider = this.catalogProvider(provider, credential);
      const selectable = await this.modelCatalog.isSelectableModel(
        capability,
        catalogProvider,
        input.model,
        current?.model ?? null,
      );
      if (selectable === false) {
        throw new SettingsError(
          'BAD_REQUEST',
          '该模型尚未在本仓库完成适配，请选择列表中标为已验证的模型。',
        );
      }
      // 目录暂时不可用时只接受现状：不静默写入无法校验的模型。
      if (selectable === undefined && input.model !== AI_CAPABILITY_DEFAULTS[capability].model) {
        throw new SettingsError(
          'MODEL_UNAVAILABLE',
          '暂时无法从供应商读取模型列表，无法确认所选模型是否可用，请稍后重试。',
        );
      }
      if (capability === 'knowledge_embedding') {
        // 向量维度写死在 pgvector 列类型中，选错模型会让入库与检索直接失败。
        const models = await this.modelCatalog.summariesFor(capability, catalogProvider);
        const dimensions = models?.find(
          (candidate) => candidate.id === input.model,
        )?.outputDimensions;
        if (
          dimensions !== null &&
          dimensions !== undefined &&
          dimensions !== EMBEDDING_DIMENSIONS
        ) {
          throw new SettingsError(
            'BAD_REQUEST',
            `该模型输出 ${dimensions} 维向量，与当前向量索引的 ${EMBEDDING_DIMENSIONS} 维不一致。`,
          );
        }
      }
    }
    if (provider.credential.source === 'local_file') {
      await this.localCredentials.assertAvailableForBinding(
        provider.credential.alias!,
        provider.type,
      );
    } else {
      await this.resolveCredential(provider);
    }
    return this.repository.saveBinding({
      bindingId: randomUUID(),
      bindingRevisionId: randomUUID(),
      capability,
      providerConnectionId: input.providerConnectionId,
      secondaryProviderConnectionId: null,
      model: input.model,
      settings,
      ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
    });
  }

  /** 返回该能力的候选模型目录，供管理页面搜索选择。 */
  async modelCatalogFor(
    capability: AiCapability,
    query: ModelCatalogQuery = {},
  ): Promise<ModelCatalogResponse> {
    const parsed = ModelCatalogQuerySchema.parse(query);
    const providers = await this.repository.listProviders();
    const allowed = CAPABILITY_MODEL_REQUIREMENTS[capability].providers as readonly ProviderType[];
    const candidates = providers.filter((provider) => allowed.includes(provider.type));
    const inputs = await Promise.all(
      candidates.map(async (provider) => {
        try {
          return this.catalogProvider(provider, await this.resolveCredential(provider));
        } catch {
          // 单个连接的凭据不可用时，该供应商目录按不可用返回，不影响其他连接。
          return undefined;
        }
      }),
    );
    return this.modelCatalog.catalog(
      capability,
      inputs.filter((input): input is CatalogProviderInput => input !== undefined),
      parsed,
    );
  }

  /** 将完整 legacy `.env` 显式导入，不覆盖任何已有连接或能力绑定。 */
  async importLegacyConfiguration(): Promise<void> {
    if (await this.repository.importedAt()) return;
    if (
      this.legacy.missingVariables.length > 0 ||
      !this.legacy.dashScope ||
      !this.legacy.deepSeek
    ) {
      throw new SettingsError('CONFIGURATION_REQUIRED', '旧环境配置不完整，无法导入。');
    }
    const providers = await this.repository.listProviders();
    const byType = new Map(providers.map((provider) => [provider.type, provider]));
    const ensureProvider = async (
      type: ProviderType,
      name: string,
      item: { config: ProviderConnectionWrite['config']; credential: CredentialBundleInput },
    ) => {
      const existing = byType.get(type);
      if (existing) return existing;
      const created = await this.createProvider(
        {
          type,
          name,
          config: item.config,
          credentialSource: 'database',
          credential: item.credential,
        },
        { mode: 'localhost', secretSubmissionAllowed: true, warning: null },
      );
      const stored = await this.repository.getProvider(created.id);
      byType.set(type, stored);
      return stored;
    };
    const dashScope = await ensureProvider('dashscope', '旧环境 DashScope', this.legacy.dashScope);
    const deepSeek = await ensureProvider('deepseek', '旧环境 DeepSeek', this.legacy.deepSeek);
    const oss = this.legacy.oss
      ? await ensureProvider('aliyun_oss', '旧环境阿里云 OSS', this.legacy.oss)
      : undefined;
    const existingBindings = new Set(
      (await this.repository.listBindings()).map((binding) => binding.capability),
    );
    for (const capability of Object.keys(AI_CAPABILITY_DEFAULTS) as AiCapability[]) {
      if (existingBindings.has(capability)) continue;
      // 默认优先使用百炼（通义千问）；未配置时回退到 DeepSeek，并由 saveBinding 校验模型责任。
      const selected = AI_CAPABILITY_PROVIDER_PREFERENCES[capability]
        .map((type) => (type === 'dashscope' ? dashScope : type === 'deepseek' ? deepSeek : oss))
        .find((provider) => provider !== undefined);
      if (!selected) continue;
      await this.saveBinding(capability, {
        providerConnectionId: selected.id,
        secondaryProviderConnectionId: null,
        model: AI_CAPABILITY_DEFAULTS[capability].model,
        settings: supportsThinkingSetting(capability)
          ? { enableThinking: this.legacy.deepSeek.enableThinking }
          : {},
      });
    }
    await this.repository.markLegacyImported();
  }

  /** 为新任务或指定历史 revision 解析精确的供应商运行配置。 */
  async resolveCapability(
    capability: AiCapability,
    revisionId?: string,
  ): Promise<ResolvedCapability> {
    const stored = await this.repository.resolveCapability(capability, revisionId);
    if (stored) {
      const credential =
        stored.provider.reference.source === 'database'
          ? await this.databaseCredentials.resolve(stored.provider.reference, stored.provider.type)
          : await this.localCredentials.resolve(stored.provider.reference, stored.provider.type);
      return {
        revisionId: stored.revisionId,
        model: stored.model,
        settings: stored.settings,
        provider: {
          type: stored.provider.type,
          config: stored.provider.config as ProviderConnectionWrite['config'],
          credential,
        },
      };
    }
    if (revisionId || (await this.repository.importedAt())) {
      throw new SettingsError('CONFIGURATION_REQUIRED', '该 AI 能力尚未配置。');
    }
    return this.resolveLegacyCapability(capability);
  }

  private async validateProviderInput(
    input: ProviderConnectionWrite,
    transport: TransportSecurity,
    creating: boolean,
    current?: StoredProvider,
  ) {
    if (input.credential && !transport.secretSubmissionAllowed) {
      throw new SettingsError(
        'INSECURE_CREDENTIAL_TRANSPORT',
        '当前连接不是 HTTPS，不能通过网络提交 Credential。',
      );
    }
    if (creating && input.credentialSource === 'database' && !input.credential) {
      throw new SettingsError('BAD_REQUEST', '新数据库 Credential 必须提供密钥。');
    }
    if (
      !creating &&
      input.credentialSource === 'database' &&
      !input.credential &&
      current?.credential.source !== 'database'
    ) {
      throw new SettingsError('BAD_REQUEST', '切换到数据库 Credential 时必须提供密钥。');
    }
    if (input.credential) credentialSchema(input.type).parse(input.credential);
    if (input.credentialSource === 'local_file') {
      const status = await this.localCredentials.status();
      if (!status.healthy) {
        throw new SettingsError('CONFIGURATION_REQUIRED', '本地 Credential Provider 当前不可用。');
      }
      await this.localCredentials.resolve(
        { source: 'local_file', alias: input.localCredentialAlias! },
        input.type,
      );
    }
    await this.validateOutboundUrls(input);
    if (input.credentialSource === 'local_file') {
      await this.localCredentials.assertAvailableForBinding(
        input.localCredentialAlias!,
        input.type,
      );
    }
    const credential =
      input.credential ??
      (current && current.credential.source === 'database'
        ? await this.resolveCredential(current)
        : input.credentialSource === 'local_file'
          ? await this.localCredentials.resolve(
              { source: 'local_file', alias: input.localCredentialAlias! },
              input.type,
            )
          : undefined);
    if (
      input.type === 'dashscope' &&
      'asyncNotifyMode' in input.config &&
      input.config.asyncNotifyMode === 'eventbridge' &&
      (!credential ||
        !('eventBridgeCallbackToken' in credential) ||
        !credential.eventBridgeCallbackToken)
    ) {
      throw new SettingsError('BAD_REQUEST', 'EventBridge 模式需要 Callback Token。');
    }
  }

  private async validateOutboundUrls(input: ProviderConnectionWrite) {
    const values =
      input.type === 'dashscope'
        ? [
            (input.config as { baseUrl: string }).baseUrl,
            (input.config as { compatibleBaseUrl: string }).compatibleBaseUrl,
            (input.config as { rerankBaseUrl?: string }).rerankBaseUrl,
          ]
        : input.type === 'deepseek'
          ? [(input.config as { baseUrl: string }).baseUrl]
          : [];
    for (const value of values.filter((item): item is string => Boolean(item))) {
      const hostname = new URL(value).hostname;
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        isPrivateNetworkAddress(hostname)
      ) {
        throw new SettingsError('BAD_REQUEST', '供应商端点不能指向本机或私有网络。');
      }
      let addresses;
      try {
        addresses = await lookup(hostname, { all: true, verbatim: true });
      } catch {
        throw new SettingsError('BAD_REQUEST', '供应商端点域名无法解析。');
      }
      if (
        addresses.length === 0 ||
        addresses.some(({ address }) => isPrivateNetworkAddress(address))
      ) {
        throw new SettingsError('BAD_REQUEST', '供应商端点解析到了非公网地址。');
      }
    }
  }

  private async providerRecord(input: ProviderConnectionWrite, current?: StoredProvider) {
    const connectionId = current?.id ?? randomUUID();
    const providerRevisionId = randomUUID();
    if (input.credentialSource === 'local_file') {
      return {
        connectionId,
        providerRevisionId,
        type: input.type,
        name: input.name,
        config: input.config,
        credentialSource: 'local_file' as const,
        localCredentialAlias: input.localCredentialAlias!,
      };
    }
    const credentialId =
      current?.credential.source === 'database' && current.credentialId
        ? current.credentialId
        : randomUUID();
    if (!input.credential) {
      if (!current?.credentialVersionId || !current.credentialVersion) {
        throw new SettingsError('BAD_REQUEST', '数据库 Credential 未配置。');
      }
      return {
        connectionId,
        providerRevisionId,
        credentialId,
        credentialVersionId: current.credentialVersionId,
        credentialVersion: current.credentialVersion,
        type: input.type,
        name: input.name,
        config: input.config,
        credentialSource: 'database' as const,
      };
    }
    const credentialVersion = (current?.credentialVersion ?? 0) + 1;
    const credentialVersionId = randomUUID();
    return {
      connectionId,
      providerRevisionId,
      credentialId,
      credentialVersionId,
      credentialVersion,
      type: input.type,
      name: input.name,
      config: input.config,
      credentialSource: 'database' as const,
      encryptedCredential: encryptCredential({
        masterKey: this.masterKey,
        tenantId: this.tenantId,
        credentialId,
        version: credentialVersion,
        type: input.type,
        bundle: input.credential,
      }),
    };
  }

  private resolveCredential(provider: StoredProvider): Promise<CredentialBundle> {
    const reference: CredentialReference =
      provider.credential.source === 'database'
        ? { source: 'database', credentialVersionId: provider.credentialVersionId! }
        : { source: 'local_file', alias: provider.credential.alias! };
    return reference.source === 'database'
      ? this.databaseCredentials.resolve(reference, provider.type)
      : this.localCredentials.resolve(reference, provider.type);
  }

  /** 把已存储连接与其 Credential 组合为目录查询输入。 */
  private catalogProvider(
    provider: StoredProvider,
    credential: CredentialBundle,
  ): CatalogProviderInput {
    return {
      connectionId: provider.id,
      providerType: provider.type,
      name: provider.name,
      config: provider.config,
      credential,
    };
  }

  private resolveLegacyCapability(capability: AiCapability): ResolvedCapability {
    if (capability === 'audio_primary_storage') {
      throw new SettingsError(
        'CONFIGURATION_REQUIRED',
        '权威音频对象存储必须在 AI 配置中显式绑定，不能复用旧版临时 OSS。',
      );
    }
    if (capability === 'audio_staging') {
      if (!this.legacy.oss) {
        throw new SettingsError('CONFIGURATION_REQUIRED', '音频临时 OSS 尚未配置。');
      }
      return {
        revisionId: null,
        model: AI_CAPABILITY_DEFAULTS[capability].model,
        settings: {},
        provider: {
          type: 'aliyun_oss',
          config: this.legacy.oss.config,
          credential: this.legacy.oss.credential,
        },
      };
    }
    const preferred = AI_CAPABILITY_PROVIDER_PREFERENCES[capability][0];
    if (preferred === 'dashscope') {
      if (!this.legacy.dashScope) {
        throw new SettingsError('CONFIGURATION_REQUIRED', 'DashScope 尚未配置。');
      }
      return {
        revisionId: null,
        model: AI_CAPABILITY_DEFAULTS[capability].model,
        settings: {},
        provider: {
          type: 'dashscope',
          config: this.legacy.dashScope.config,
          credential: this.legacy.dashScope.credential,
        },
      };
    }
    if (!this.legacy.deepSeek) {
      throw new SettingsError('CONFIGURATION_REQUIRED', 'DeepSeek 尚未配置。');
    }
    return {
      revisionId: null,
      model: AI_CAPABILITY_DEFAULTS[capability].model,
      settings: supportsThinkingSetting(capability)
        ? { enableThinking: this.legacy.deepSeek.enableThinking }
        : {},
      provider: {
        type: 'deepseek',
        config: this.legacy.deepSeek.config,
        credential: this.legacy.deepSeek.credential,
      },
    };
  }
}
