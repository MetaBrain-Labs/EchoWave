/**
 * AI 配置服务默认能力测试。
 *
 * 验证能力保存与旧配置导入共同依赖共享契约中的权威默认模型和供应商类型。
 *
 * Responsibilities:
 * - 锁定默认模型校验和供应商兼容性。
 * - 锁定旧配置导入生成的能力绑定来源。
 *
 * Notes:
 * - 使用内存仓储替身，不连接 PostgreSQL 或真实 Credential Provider。
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';

import { AI_CAPABILITY_DEFAULTS, AI_CAPABILITY_PROVIDER_PREFERENCES } from '@echowave/contracts';

import { SettingsService } from '../../dist/settings/service.js';

const providerIds = {
  dashscope: '11111111-1111-4111-8111-111111111111',
  deepseek: '22222222-2222-4222-8222-222222222222',
  aliyun_oss: '33333333-3333-4333-8333-333333333333',
};

function storedProvider(type) {
  return {
    id: providerIds[type],
    type,
    name: type,
    revision: 1,
    config:
      type === 'dashscope'
        ? {
            baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
            compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            asyncNotifyMode: 'polling',
            eventBridgeCallbackUrl: null,
          }
        : type === 'deepseek'
          ? { baseUrl: 'https://api.deepseek.com' }
          : { region: 'oss-cn-beijing', bucket: 'echowave-test' },
    credential: {
      source: 'local_file',
      configured: true,
      alias: `${type}-main`,
      maskedValue: null,
    },
    credentialVersionId: null,
    credentialId: null,
    credentialVersion: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

/** 目录替身：返回固定候选，便于断言“能力目录之外的模型被拒绝”。 */
function catalogService(modelsByCapability = {}, verifiedByCapability = {}) {
  const summaries = (capability) =>
    (modelsByCapability[capability] ?? []).map((model) => ({
      id: model,
      displayName: model,
      description: '',
      capabilities: [],
      features: [],
      contextWindow: null,
      maxOutputTokens: null,
      outputDimensions: null,
      pricing: null,
      recommended: false,
      verified: (verifiedByCapability[capability] ?? []).includes(model),
    }));
  return {
    async summariesFor(capability) {
      return modelsByCapability[capability] ? summaries(capability) : undefined;
    },
    async isSelectableModel(capability, _provider, model, currentModel) {
      const models = modelsByCapability[capability];
      if (!models) return undefined;
      if ((verifiedByCapability[capability] ?? []).includes(model)) return true;
      if (!models.includes(model)) return false;
      // 目录中存在但未在本仓库适配：只允许保持已有绑定。
      return currentModel === model;
    },
    async catalog(capability, providers) {
      return {
        capability,
        providers: providers.map((provider) => ({
          connectionId: provider.connectionId,
          providerType: provider.providerType,
          name: provider.name,
          catalogAvailable: true,
          unavailableReason: null,
          defaultModel: null,
          models: summaries(capability),
        })),
      };
    },
  };
}

/** 绑定校验会读取当前绑定以判断“未改动”，替身默认没有既有绑定。 */
function repositoryStub(overrides = {}) {
  return { listBindings: async () => [], ...overrides };
}

function settingsService(repository, legacy = {}, catalog = catalogService({})) {
  return new SettingsService(
    repository,
    {
      resolve: async () => ({ apiKey: 'resolved-key' }),
    },
    {
      assertAvailableForBinding: async () => undefined,
      resolve: async () => ({ apiKey: 'resolved-key' }),
    },
    '00000000-0000-4000-8000-000000000001',
    Buffer.alloc(32),
    'admin-token',
    {
      detectedVariables: [],
      missingVariables: [],
      ...legacy,
    },
    catalog,
  );
}

describe('SettingsService defaults', () => {
  it('accepts a verified model and rejects one outside the capability catalogue', async () => {
    let saved;
    const provider = storedProvider('dashscope');
    const service = settingsService(
      repositoryStub({
        getProvider: async () => provider,
        saveBinding: async (input) => {
          saved = input;
          return input;
        },
      }),
      {},
      catalogService(
        { knowledge_chat: ['qwen3.5-omni-flash', 'qwen3-max'] },
        { knowledge_chat: ['qwen3-max'] },
      ),
    );

    await service.saveBinding('knowledge_chat', {
      providerConnectionId: provider.id,
      secondaryProviderConnectionId: null,
      model: 'qwen3-max',
      settings: { enableThinking: false },
    });
    assert.equal(saved.model, 'qwen3-max');
    assert.equal(saved.providerConnectionId, provider.id);

    await assert.rejects(
      service.saveBinding('knowledge_chat', {
        providerConnectionId: provider.id,
        secondaryProviderConnectionId: null,
        model: 'qwen-image-max',
        settings: { enableThinking: false },
      }),
      (error) => error.code === 'BAD_REQUEST',
    );
  });

  it('lists a catalogued model but refuses to bind it until this repository adapts it', async () => {
    const provider = storedProvider('dashscope');
    const service = settingsService(
      repositoryStub({
        getProvider: async () => provider,
        saveBinding: async () => {
          throw new Error('must not persist');
        },
      }),
      {},
      // 目录里存在，但没有声明为已验证 → 不允许新选择。
      catalogService({ knowledge_chat: ['qwen3.5-omni-flash', 'glm-5.1'] }),
    );

    await assert.rejects(
      service.saveBinding('knowledge_chat', {
        providerConnectionId: provider.id,
        secondaryProviderConnectionId: null,
        model: 'glm-5.1',
        settings: { enableThinking: false },
      }),
      (error) => error.code === 'BAD_REQUEST' && /已验证/.test(error.message),
    );
  });

  it('pins the capability default model as always bindable', async () => {
    let saved;
    const provider = storedProvider('dashscope');
    const service = settingsService(
      repositoryStub({
        getProvider: async () => provider,
        saveBinding: async (input) => {
          saved = input;
          return input;
        },
      }),
      {},
      // 目录不可用时默认模型仍然可写入，保证首次配置不会卡死。
      catalogService({}),
    );

    await service.saveBinding('knowledge_chat', {
      providerConnectionId: provider.id,
      secondaryProviderConnectionId: null,
      model: AI_CAPABILITY_DEFAULTS.knowledge_chat.model,
      settings: { enableThinking: false },
    });

    assert.equal(saved.model, AI_CAPABILITY_DEFAULTS.knowledge_chat.model);
  });

  it('keeps a verified model bindable even when the provider list is unavailable', async () => {
    let saved;
    const provider = storedProvider('dashscope');
    const service = settingsService(
      repositoryStub({
        getProvider: async () => provider,
        saveBinding: async (input) => {
          saved = input;
          return input;
        },
      }),
      {},
      // 目录整体不可用：已验证模型（这里是 Embedding 默认模型）仍必须可保存。
      catalogService({}),
    );

    await service.saveBinding('knowledge_embedding', {
      providerConnectionId: provider.id,
      secondaryProviderConnectionId: null,
      model: AI_CAPABILITY_DEFAULTS.knowledge_embedding.model,
      settings: {},
    });

    assert.equal(saved.model, AI_CAPABILITY_DEFAULTS.knowledge_embedding.model);
  });

  it('keeps DeepSeek available as the fallback provider for text capabilities', async () => {
    let saved;
    const provider = storedProvider('deepseek');
    const service = settingsService(
      repositoryStub({
        getProvider: async () => provider,
        saveBinding: async (input) => {
          saved = input;
          return input;
        },
      }),
      {},
      catalogService(
        { knowledge_chat: ['deepseek-v4-flash'] },
        { knowledge_chat: ['deepseek-v4-flash'] },
      ),
    );

    await service.saveBinding('knowledge_chat', {
      providerConnectionId: provider.id,
      secondaryProviderConnectionId: null,
      model: 'deepseek-v4-flash',
      settings: { enableThinking: false },
    });
    assert.equal(saved.model, 'deepseek-v4-flash');
  });

  it('refuses to persist an unverifiable model while the provider catalog is unavailable', async () => {
    const provider = storedProvider('dashscope');
    const service = settingsService(
      repositoryStub({
        getProvider: async () => provider,
        saveBinding: async () => {
          throw new Error('must not persist');
        },
      }),
      {},
      catalogService({}),
    );

    await assert.rejects(
      service.saveBinding('knowledge_chat', {
        providerConnectionId: provider.id,
        secondaryProviderConnectionId: null,
        model: 'qwen3-max',
        settings: { enableThinking: false },
      }),
      (error) => error.code === 'MODEL_UNAVAILABLE',
    );
  });

  it('rejects a text capability bound to a non-text provider', async () => {
    const provider = storedProvider('aliyun_oss');
    const service = settingsService(
      repositoryStub({
        getProvider: async () => provider,
        saveBinding: async () => {
          throw new Error('must not persist');
        },
      }),
    );

    await assert.rejects(
      service.saveBinding('knowledge_chat', {
        providerConnectionId: provider.id,
        secondaryProviderConnectionId: null,
        model: AI_CAPABILITY_DEFAULTS.knowledge_chat.model,
        settings: { enableThinking: false },
      }),
      (error) => error.code === 'BAD_REQUEST',
    );
  });

  it('rejects an embedding model whose vector dimensions differ from the index', async () => {
    const provider = storedProvider('dashscope');
    const catalog = catalogService(
      { knowledge_embedding: ['qwen3.7-text-embedding', 'text-embedding-v3'] },
      { knowledge_embedding: ['text-embedding-v3'] },
    );
    catalog.summariesFor = async (capability) =>
      capability === 'knowledge_embedding'
        ? [
            {
              id: 'text-embedding-v3',
              displayName: 'text-embedding-v3',
              description: '',
              capabilities: [],
              features: [],
              contextWindow: null,
              maxOutputTokens: null,
              outputDimensions: 512,
              pricing: null,
              recommended: false,
              verified: true,
            },
          ]
        : undefined;
    const service = settingsService(
      repositoryStub({
        getProvider: async () => provider,
        saveBinding: async () => {
          throw new Error('must not persist');
        },
      }),
      {},
      catalog,
    );

    await assert.rejects(
      service.saveBinding('knowledge_embedding', {
        providerConnectionId: provider.id,
        secondaryProviderConnectionId: null,
        model: 'text-embedding-v3',
        settings: {},
      }),
      (error) => error.code === 'BAD_REQUEST' && /512/.test(error.message),
    );
  });

  it('still refuses an unknown backend for the fixed OSS capabilities', async () => {
    const provider = storedProvider('aliyun_oss');
    const service = settingsService(
      repositoryStub({
        getProvider: async () => provider,
        saveBinding: async () => {
          throw new Error('must not persist');
        },
      }),
    );

    await assert.rejects(
      service.saveBinding('audio_staging', {
        providerConnectionId: provider.id,
        secondaryProviderConnectionId: null,
        model: 'qwen3-max',
        settings: {},
      }),
      (error) => error.code === 'BAD_REQUEST',
    );
  });

  it('imports legacy bindings with shared default models and provider types', async () => {
    const providers = [
      storedProvider('dashscope'),
      storedProvider('deepseek'),
      storedProvider('aliyun_oss'),
    ];
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    const saved = [];
    let marked = false;
    const service = settingsService(
      {
        importedAt: async () => null,
        listProviders: async () => providers,
        listBindings: async () => [],
        getProvider: async (id) => byId.get(id),
        saveBinding: async (input) => {
          saved.push(input);
          return input;
        },
        markLegacyImported: async () => {
          marked = true;
        },
      },
      {
        dashScope: { config: providers[0].config, credential: { apiKey: 'unused' } },
        deepSeek: {
          config: providers[1].config,
          credential: { apiKey: 'unused' },
          enableThinking: true,
        },
        oss: {
          config: providers[2].config,
          credential: { accessKeyId: 'unused', accessKeySecret: 'unused' },
        },
      },
    );

    await service.importLegacyConfiguration();

    assert.equal(marked, true);
    assert.equal(saved.length, 9);
    for (const binding of saved) {
      const defaults = AI_CAPABILITY_DEFAULTS[binding.capability];
      assert.equal(binding.model, defaults.model);
      // 默认优先百炼（通义千问）；DeepSeek 只作为文本能力的成本备选方案保留。
      assert.equal(
        byId.get(binding.providerConnectionId).type,
        AI_CAPABILITY_PROVIDER_PREFERENCES[binding.capability][0],
      );
    }
    assert.equal(
      saved.find((binding) => binding.capability === 'audio_primary_storage').providerConnectionId,
      providerIds.aliyun_oss,
    );
    // 旧 .env 的 Thinking 开关仍写入支持该设置的能力。
    assert.deepEqual(saved.find((binding) => binding.capability === 'knowledge_chat').settings, {
      enableThinking: true,
    });
  });
});
