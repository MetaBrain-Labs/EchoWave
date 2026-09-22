/**
 * 租户级知识检索设置服务测试。
 *
 * 验证关闭短路、启用配置解析和管理员乐观锁更新边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { KnowledgeRetrievalSettingsService } from '../../../dist/knowledge/retrieval/settingsService.js';
import { SettingsError } from '../../../dist/settings/types.js';

describe('KnowledgeRetrievalSettingsService', () => {
  it('does not resolve or decrypt the rerank capability while disabled', async () => {
    let resolveCalls = 0;
    const service = new KnowledgeRetrievalSettingsService(
      { get: async () => ({ rerankEnabled: false, revision: 4 }) },
      {
        authorize: () => undefined,
        resolveCapability: async () => {
          resolveCalls += 1;
          throw new Error('must not resolve');
        },
      },
    );

    assert.deepEqual(await service.overview(), {
      rerankEnabled: false,
      rerankerModel: 'qwen3.7-text-rerank',
      rerankerConfigured: false,
      revision: 4,
    });
    assert.deepEqual(await service.freezeRuntime(), {
      enabled: false,
      revision: 4,
      bindingRevisionId: null,
      model: null,
    });
    assert.equal(resolveCalls, 0);
  });

  it('freezes the configured Workspace binding and safely represents missing configuration', async () => {
    const stored = { rerankEnabled: true, revision: 2 };
    const configured = new KnowledgeRetrievalSettingsService(
      { get: async () => stored },
      {
        authorize: () => undefined,
        resolveCapability: async () => ({
          revisionId: '11111111-1111-4111-8111-111111111111',
          model: 'qwen3.7-text-rerank',
          provider: {
            type: 'dashscope',
            credential: { apiKey: 'secret' },
            config: { rerankBaseUrl: 'https://workspace.example.com/api/v1/' },
          },
        }),
      },
    );
    assert.deepEqual(await configured.freezeRuntime(), {
      enabled: true,
      revision: 2,
      bindingRevisionId: '11111111-1111-4111-8111-111111111111',
      model: 'qwen3.7-text-rerank',
      apiKey: 'secret',
      baseUrl: 'https://workspace.example.com/api/v1',
    });

    const missing = new KnowledgeRetrievalSettingsService(
      { get: async () => stored },
      {
        authorize: () => undefined,
        resolveCapability: async () => {
          throw new SettingsError('CONFIGURATION_REQUIRED', '未配置。');
        },
      },
    );
    assert.equal((await missing.overview()).rerankerConfigured, false);
    assert.deepEqual(await missing.freezeRuntime(), {
      enabled: true,
      revision: 2,
      bindingRevisionId: null,
      model: 'qwen3.7-text-rerank',
      apiKey: '',
      baseUrl: '',
    });
  });

  it('authorizes and forwards the expected revision before returning authoritative state', async () => {
    let authorization;
    let updated;
    const repository = {
      get: async () => ({ rerankEnabled: false, revision: 6 }),
      update: async (input) => {
        updated = input;
      },
    };
    const service = new KnowledgeRetrievalSettingsService(repository, {
      authorize: (value) => {
        authorization = value;
      },
      resolveCapability: async () => {
        throw new Error('disabled state must not resolve');
      },
    });

    const result = await service.update('Bearer admin', {
      rerankEnabled: false,
      expectedRevision: 5,
    });

    assert.equal(authorization, 'Bearer admin');
    assert.deepEqual(updated, { rerankEnabled: false, expectedRevision: 5 });
    assert.equal(result.revision, 6);
  });
});
