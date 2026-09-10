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

import { AI_CAPABILITY_DEFAULTS } from '@echowave/contracts';

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

function settingsService(repository, legacy = {}) {
  return new SettingsService(
    repository,
    {},
    {
      assertAvailableForBinding: async () => undefined,
    },
    '00000000-0000-4000-8000-000000000001',
    Buffer.alloc(32),
    'admin-token',
    {
      detectedVariables: [],
      missingVariables: [],
      ...legacy,
    },
  );
}

describe('SettingsService defaults', () => {
  it('accepts the shared default model and rejects a different model', async () => {
    let saved;
    const provider = storedProvider('deepseek');
    const service = settingsService({
      getProvider: async () => provider,
      saveBinding: async (input) => {
        saved = input;
        return input;
      },
    });

    await service.saveBinding('knowledge_chat', {
      providerConnectionId: provider.id,
      secondaryProviderConnectionId: null,
      model: AI_CAPABILITY_DEFAULTS.knowledge_chat.model,
      settings: AI_CAPABILITY_DEFAULTS.knowledge_chat.settings,
    });
    assert.equal(saved.model, AI_CAPABILITY_DEFAULTS.knowledge_chat.model);
    assert.equal(saved.providerConnectionId, provider.id);

    await assert.rejects(
      service.saveBinding('knowledge_chat', {
        providerConnectionId: provider.id,
        secondaryProviderConnectionId: null,
        model: 'unsupported-model',
        settings: { enableThinking: false },
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
    assert.equal(saved.length, 8);
    for (const binding of saved) {
      const defaults = AI_CAPABILITY_DEFAULTS[binding.capability];
      assert.equal(binding.model, defaults.model);
      assert.equal(byId.get(binding.providerConnectionId).type, defaults.providerType);
    }
    assert.equal(
      saved.some((binding) => binding.capability === 'audio_primary_storage'),
      false,
    );
  });
});
