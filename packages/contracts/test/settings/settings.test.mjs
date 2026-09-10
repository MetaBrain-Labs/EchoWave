/**
 * 配置中心共享契约测试。
 *
 * 验证双 Credential 来源、严格供应商配置和脱敏概览边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AI_CAPABILITY_DEFAULTS,
  AiCapabilitySchema,
  ProviderConnectionWriteSchema,
  SettingsOverviewSchema,
} from '../../dist/settings.js';

describe('settings contracts', () => {
  it('accepts a Local alias connection and a Secret-free overview', () => {
    assert.equal(
      ProviderConnectionWriteSchema.parse({
        type: 'deepseek',
        name: '主连接',
        config: { baseUrl: 'https://api.deepseek.com' },
        credentialSource: 'local_file',
        localCredentialAlias: 'deepseek-v2',
      }).localCredentialAlias,
      'deepseek-v2',
    );
    const overview = SettingsOverviewSchema.parse({
      transport: {
        mode: 'insecure_remote_http',
        secretSubmissionAllowed: false,
        warning: 'HTTPS required',
      },
      localCredentials: {
        configured: true,
        healthy: true,
        lastLoadedAt: null,
        error: null,
        credentials: [{ alias: 'deepseek-v2', type: 'deepseek', available: true }],
      },
      providers: [],
      bindings: [],
      legacy: { detectedVariables: [], missingVariables: [], ready: false, importedAt: null },
    });
    assert.equal(JSON.stringify(overview).includes('apiKey'), false);
  });

  it('rejects mixed Local and Database Credential fields and unknown config keys', () => {
    assert.equal(
      ProviderConnectionWriteSchema.safeParse({
        type: 'deepseek',
        name: 'invalid',
        config: { baseUrl: 'https://api.deepseek.com', extra: true },
        credentialSource: 'local_file',
        localCredentialAlias: 'deepseek-v2',
        credential: { apiKey: 'must-not-be-mixed' },
      }).success,
      false,
    );
  });

  it('defines a valid default for every AI capability', () => {
    assert.deepEqual(Object.keys(AI_CAPABILITY_DEFAULTS), AiCapabilitySchema.options);
    for (const [capability, defaults] of Object.entries(AI_CAPABILITY_DEFAULTS)) {
      assert.equal(AiCapabilitySchema.parse(capability), capability);
      assert.equal(defaults.model.length > 0, true);
      assert.equal(['dashscope', 'deepseek', 'aliyun_oss'].includes(defaults.providerType), true);
    }
    assert.deepEqual(AI_CAPABILITY_DEFAULTS.knowledge_chat.settings, {
      enableThinking: false,
    });
    assert.deepEqual(AI_CAPABILITY_DEFAULTS.business_analysis.settings, {
      enableThinking: false,
    });
  });
});
