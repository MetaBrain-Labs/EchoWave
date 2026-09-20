/**
 * 供应商模型目录测试。
 *
 * 验证百炼模型列表按能力责任过滤、结果缓存、失败降级，以及目录不可用时绑定校验的拒绝语义。
 *
 * Responsibilities:
 * - 锁定“不符合职责的模型不可选择”：文本模型不进入 Embedding/ASR 目录，ASR 模型不进入情绪目录。
 * - 锁定上游失败不会缓存、也不会把错误正文泄漏给客户端。
 *
 * Notes:
 * - 使用脚本化 fetch 替身，不连接真实供应商。
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';

import { ModelCatalogService } from '../../dist/settings/modelCatalog.js';
import { SettingsService } from '../../dist/settings/service.js';

const connectionId = '11111111-1111-4111-8111-111111111111';
const tenantId = '00000000-0000-4000-8000-000000000001';

/** 构造百炼风格的模型列表条目。 */
function model(overrides) {
  return {
    model: 'qwen3-max',
    name: '通义千问3-Max',
    description: '通用文本生成模型。',
    capabilities: ['TG'],
    features: ['structured-outputs', 'function-calling'],
    prices: [
      {
        range_name: 'Default',
        prices: [
          { type: 'input_token', price: '2', price_unit: '每百万tokens', price_name: '输入' },
          { type: 'output_token', price: '8', price_unit: '每百万tokens', price_name: '输出' },
        ],
      },
    ],
    inference_metadata: { request_modality: ['Text'], response_modality: ['Text'] },
    model_info: { context_window: 131072, max_output_tokens: 16384 },
    ...overrides,
  };
}

function modelList(models) {
  return { success: true, output: { total: models.length, page_no: 1, page_size: 100, models } };
}

function dashScopeProvider() {
  return {
    id: connectionId,
    type: 'dashscope',
    name: '百炼',
    revision: 1,
    config: {
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      asyncNotifyMode: 'polling',
      eventBridgeCallbackUrl: null,
    },
    credential: {
      source: 'local_file',
      configured: true,
      alias: 'dashscope-main',
      maskedValue: null,
    },
    credentialVersionId: null,
    credentialId: null,
    credentialVersion: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

const deepSeekProvider = {
  ...dashScopeProvider(),
  id: '22222222-2222-4222-8222-222222222222',
  type: 'deepseek',
  name: 'DeepSeek',
  config: { baseUrl: 'https://api.deepseek.com' },
};

function settingsService(providers, catalogService) {
  return new SettingsService(
    {
      listProviders: async () => providers,
      getProvider: async (id) => providers.find((provider) => provider.id === id),
    },
    { resolve: async () => ({ apiKey: 'resolved-key' }) },
    {
      resolve: async () => ({ apiKey: 'resolved-key' }),
      assertAvailableForBinding: async () => undefined,
    },
    tenantId,
    Buffer.alloc(32),
    'admin-token',
    { detectedVariables: [], missingVariables: [] },
    catalogService,
  );
}

describe('ModelCatalogService', () => {
  it('keeps only text-generation models in the chat catalog and exposes their price', async () => {
    const urls = [];
    const service = new ModelCatalogService({
      fetch: async (url) => {
        urls.push(String(url));
        return Response.json(
          modelList([
            model({}),
            model({
              model: 'qwen-image-max',
              inference_metadata: { request_modality: ['Text'], response_modality: ['Image'] },
            }),
            model({ model: 'qwen3.7-text-embedding', capabilities: ['TR'] }),
          ]),
        );
      },
    });

    const result = await service.catalog('knowledge_chat', [
      {
        connectionId,
        providerType: 'dashscope',
        name: '百炼',
        config: dashScopeProvider().config,
        credential: { apiKey: 'secret-key' },
      },
    ]);

    const catalog = result.providers[0];
    assert.equal(catalog.catalogAvailable, true);
    assert.deepEqual(
      catalog.models.map((item) => item.id),
      ['qwen3-max'],
    );
    assert.equal(catalog.models[0].recommended, true);
    assert.deepEqual(catalog.models[0].pricing.entries[0], {
      type: 'input_token',
      name: '输入',
      amount: 2,
      unit: '每百万tokens',
      range: 'Default',
    });
    assert.equal(urls.length, 1);
    assert.match(urls[0], /capabilities=TG/);
    assert.match(urls[0], /supports=inference/);
  });

  it('never offers text or ASR models for embedding and emotion capabilities', async () => {
    const service = new ModelCatalogService({
      fetch: async () =>
        Response.json(
          modelList([
            model({}),
            model({
              model: 'qwen3.7-text-embedding',
              capabilities: ['TR'],
              inference_metadata: { request_modality: ['Text'], response_modality: ['Text'] },
            }),
            model({
              model: 'qwen-audio-3.0-asr-flash-filetrans',
              capabilities: ['ASR'],
              inference_metadata: { request_modality: ['Audio'], response_modality: ['Text'] },
            }),
            model({
              model: 'qwen3.5-omni-flash',
              capabilities: ['TG', 'Multimodal-Omni'],
              inference_metadata: {
                request_modality: ['Text', 'Audio'],
                response_modality: ['Text'],
              },
            }),
          ]),
        ),
    });
    const provider = {
      connectionId,
      providerType: 'dashscope',
      name: '百炼',
      config: dashScopeProvider().config,
      credential: { apiKey: 'secret-key' },
    };

    const embedding = await service.catalog('knowledge_embedding', [provider]);
    assert.equal(embedding.providers[0].catalogAvailable, true);
    assert.equal(embedding.providers[0].models[0].id, 'qwen3.7-text-embedding');

    const emotion = await service.catalog('audio_emotion', [provider]);
    // 情绪必须同时支持文本输出与音频输入：纯文本模型与 ASR 专用模型都被排除。
    assert.deepEqual(
      emotion.providers[0].models.map((item) => item.id),
      ['qwen3.5-omni-flash'],
    );

    const transcription = await service.catalog('audio_transcription', [provider]);
    assert.deepEqual(
      transcription.providers[0].models.map((item) => item.id),
      ['qwen-audio-3.0-asr-flash-filetrans'],
    );
  });

  it('caches a successful catalog and does not cache upstream failures', async () => {
    let calls = 0;
    const service = new ModelCatalogService({
      fetch: async () => {
        calls += 1;
        if (calls === 1) return new Response('nope', { status: 401 });
        return Response.json(modelList([model({})]));
      },
    });
    const provider = {
      connectionId,
      providerType: 'dashscope',
      name: '百炼',
      config: dashScopeProvider().config,
      credential: { apiKey: 'secret-key' },
    };

    const failed = await service.catalog('knowledge_chat', [provider]);
    assert.equal(failed.providers[0].catalogAvailable, false);
    assert.match(failed.providers[0].unavailableReason, /模型列表/);
    assert.deepEqual(failed.providers[0].models, []);
    assert.equal(JSON.stringify(failed).includes('secret-key'), false);
    assert.equal(JSON.stringify(failed).includes('dashscope.aliyuncs.com'), false);

    const first = await service.catalog('knowledge_chat', [provider]);
    const second = await service.catalog('knowledge_chat', [provider]);
    assert.equal(first.providers[0].catalogAvailable, true);
    assert.equal(second.providers[0].catalogAvailable, true);
    // 第二次读取命中缓存，只额外发生一次真实请求。
    assert.equal(calls, 2);
  });

  it('reports the static DeepSeek fallback catalog without calling the provider', async () => {
    let calls = 0;
    const service = new ModelCatalogService({
      fetch: async () => {
        calls += 1;
        throw new Error('must not call the network for DeepSeek');
      },
    });

    const result = await service.catalog('knowledge_chat', [
      {
        connectionId: deepSeekProvider.id,
        providerType: 'deepseek',
        name: 'DeepSeek',
        config: { baseUrl: 'https://api.deepseek.com' },
        credential: { apiKey: 'secret-key' },
      },
    ]);

    assert.equal(calls, 0);
    assert.deepEqual(
      result.providers.flatMap((provider) => provider.models.map((item) => item.id)),
      ['deepseek-v4-flash'],
    );
    assert.equal(
      await service.isSelectableModel(
        'knowledge_chat',
        {
          connectionId: deepSeekProvider.id,
          providerType: 'deepseek',
          name: 'DeepSeek',
          config: { baseUrl: 'https://api.deepseek.com' },
          credential: { apiKey: 'secret-key' },
        },
        'deepseek-v4-flash',
      ),
      true,
    );
  });

  it('returns the DashScope and DeepSeek catalogs together for text capabilities', async () => {
    const service = new ModelCatalogService({
      fetch: async () => Response.json(modelList([model({})])),
    });
    const catalogService = settingsService([dashScopeProvider(), deepSeekProvider], service);

    const result = await catalogService.modelCatalogFor('knowledge_chat');

    assert.deepEqual(
      result.providers.map((provider) => provider.providerType),
      ['dashscope', 'deepseek'],
    );
    // 静态备用清单与实时目录都可用，服务端据此严格校验所选模型。
    assert.equal(
      await service.isSelectableModel(
        'knowledge_embedding',
        {
          connectionId,
          providerType: 'dashscope',
          name: '百炼',
          config: dashScopeProvider().config,
          credential: { apiKey: 'secret-key' },
        },
        'qwen3.7-text-embedding',
      ),
      true,
    );
  });

  it('reports an unavailable catalog when the provider cannot be reached', async () => {
    const service = new ModelCatalogService({
      fetch: async () => {
        throw new Error('network down');
      },
    });
    const catalogService = settingsService([dashScopeProvider()], service);

    const result = await catalogService.modelCatalogFor('knowledge_chat');

    assert.equal(result.providers[0].catalogAvailable, false);
    assert.equal(
      result.providers[0].unavailableReason,
      '暂时无法读取该供应商的模型列表，请稍后重试。',
    );
  });
});
