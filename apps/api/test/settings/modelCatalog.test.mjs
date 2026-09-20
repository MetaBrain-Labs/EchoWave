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
    // 默认模型固定置顶并标记已验证，其余候选按目录顺序跟随。
    assert.deepEqual(
      catalog.models.map((item) => item.id),
      ['qwen3.5-omni-flash', 'qwen3-max'],
    );
    assert.equal(catalog.models[0].verified, true);
    assert.equal(catalog.models[1].recommended, true);
    assert.deepEqual(catalog.models[1].pricing.entries[0], {
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
              model_info: { context_window: 8192, output_dimensions: 1024 },
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
    assert.deepEqual(
      embedding.providers[0].models.map((item) => item.id),
      ['qwen3.7-text-embedding'],
    );
    // 向量维度来自模型元数据，是绑定校验拒绝维度不一致模型的依据。
    assert.equal(embedding.providers[0].models[0].outputDimensions, 1024);
    assert.equal(embedding.providers[0].models[0].verified, true);

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

  it('pins the verified default model first even when the provider omits it', async () => {
    const service = new ModelCatalogService({
      // 供应商按能力过滤后没有返回默认模型，选择器仍必须把它固定置顶并标注已验证。
      fetch: async () =>
        Response.json(
          modelList([
            model({
              model: 'text-embedding-v4',
              capabilities: ['TR'],
              model_info: { context_window: 8192, output_dimensions: 1024 },
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

    const result = await service.catalog('knowledge_embedding', [provider]);

    assert.deepEqual(
      result.providers[0].models.map((item) => item.id),
      ['qwen3.7-text-embedding', 'text-embedding-v4'],
    );
    assert.deepEqual(
      result.providers[0].models.map((item) => item.verified),
      [true, false],
    );
    assert.equal(result.providers[0].defaultModel, 'qwen3.7-text-embedding');
  });

  it('lists models that are not adapted for the capability but refuses to bind them', async () => {
    const service = new ModelCatalogService({
      fetch: async () =>
        Response.json(
          modelList([
            model({
              model: 'qwen3.7-text-embedding',
              capabilities: ['TR'],
              model_info: { context_window: 8192, output_dimensions: 1024 },
            }),
            model({
              model: 'text-embedding-v4',
              capabilities: ['TR'],
              model_info: { context_window: 8192, output_dimensions: 1024 },
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

    // 未适配模型在目录中可见，但不能被新选择；已绑定未改动的模型保持可用。
    const catalog = await service.catalog('knowledge_embedding', [provider]);
    assert.deepEqual(
      catalog.providers[0].models.map((item) => item.verified),
      [true, false],
    );
    assert.equal(
      await service.isSelectableModel('knowledge_embedding', provider, 'text-embedding-v4', null),
      false,
    );
    assert.equal(
      await service.isSelectableModel(
        'knowledge_embedding',
        provider,
        'text-embedding-v4',
        'text-embedding-v4',
      ),
      true,
    );
    assert.equal(
      await service.isSelectableModel(
        'knowledge_embedding',
        provider,
        'qwen3.7-text-embedding',
        null,
      ),
      true,
    );
  });

  it('falls back to an unfiltered request when the provider rejects the filter parameters', async () => {
    const urls = [];
    const service = new ModelCatalogService({
      fetch: async (url) => {
        urls.push(String(url));
        // 带 capabilities/supports 的请求被拒绝，退回只有分页参数的请求。
        if (String(url).includes('capabilities='))
          return new Response('bad request', { status: 400 });
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

    const result = await service.catalog('knowledge_chat', [provider]);

    assert.equal(result.providers[0].catalogAvailable, true);
    assert.deepEqual(
      result.providers[0].models.map((item) => item.id),
      ['qwen3.5-omni-flash', 'qwen3-max'],
    );
    assert.equal(urls.length, 2);
    assert.equal(urls[1].includes('capabilities='), false);
    assert.match(urls[1], /page_size=100/);
  });

  it('accepts an OpenAI-shaped list response and filters it locally', async () => {
    const service = new ModelCatalogService({
      fetch: async () =>
        Response.json({
          object: 'list',
          data: [
            { id: 'qwen3-max', object: 'model', owned_by: 'qwen' },
            { id: 'qwen-image-max', object: 'model', owned_by: 'qwen' },
          ],
        }),
    });
    const provider = {
      connectionId,
      providerType: 'dashscope',
      name: '百炼',
      config: dashScopeProvider().config,
      credential: { apiKey: 'secret-key' },
    };

    const result = await service.catalog('knowledge_chat', [provider]);

    assert.equal(result.providers[0].catalogAvailable, true);
    // 无能力元数据时按 id 兜底展示，置顶项仍是已验证默认模型。
    assert.ok(result.providers[0].models.some((item) => item.id === 'qwen3-max'));
    assert.equal(result.providers[0].models[0].id, 'qwen3.5-omni-flash');
  });

  it('keeps the emotion catalogue usable when the provider omits capability metadata', async () => {
    const service = new ModelCatalogService({
      // 缺少 capabilities 与 inference_metadata 的部署：不能因为元数据缺失就把情绪目录清空。
      fetch: async () =>
        Response.json(
          modelList([
            model({
              model: 'qwen3.5-omni-flash',
              capabilities: [],
              features: [],
              model_info: {},
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

    const result = await service.catalog('audio_emotion', [provider]);

    assert.equal(result.providers[0].catalogAvailable, true);
    assert.ok(result.providers[0].models.some((item) => item.id === 'qwen3.5-omni-flash'));
    assert.equal(result.providers[0].models[0].id, 'qwen3.5-omni-flash');
    assert.equal(result.providers[0].models[0].verified, true);
  });

  it('keeps excluding image and video models even without capability metadata', async () => {
    const service = new ModelCatalogService({
      fetch: async () =>
        Response.json(
          modelList([
            model({ model: 'qwen3.5-omni-flash', capabilities: [], features: [], model_info: {} }),
            model({
              model: 'qwen-image-max',
              capabilities: [],
              features: [],
              model_info: {},
              inference_metadata: { request_modality: ['Text'], response_modality: ['Image'] },
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

    const result = await service.catalog('audio_emotion', [provider]);

    assert.deepEqual(
      result.providers[0].models.map((item) => item.id),
      ['qwen3.5-omni-flash'],
    );
  });

  it('does not cache a failed catalog and caches the next success', async () => {
    let calls = 0;
    let failing = true;
    const service = new ModelCatalogService({
      fetch: async () => {
        calls += 1;
        if (failing) return new Response('nope', { status: 401 });
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

    // 三次备用请求全部失败：目录标记不可用，并给出可排查但不含密钥的诊断。
    const failed = await service.catalog('knowledge_chat', [provider]);
    assert.equal(failed.providers[0].catalogAvailable, false);
    assert.match(failed.providers[0].unavailableReason, /供应商返回 401/);
    // 失败时仍保留已验证默认模型，其余候选为空。
    assert.deepEqual(
      failed.providers[0].models.map((item) => item.id),
      ['qwen3.5-omni-flash'],
    );
    assert.equal(failed.providers[0].models[0].verified, true);
    assert.equal(JSON.stringify(failed).includes('secret-key'), false);
    assert.equal(JSON.stringify(failed).includes('dashscope.aliyuncs.com'), false);
    const failedCalls = calls;

    failing = false;
    const recovered = await service.catalog('knowledge_chat', [provider]);
    assert.equal(recovered.providers[0].catalogAvailable, true);
    // 失败结果不入缓存：重试会真正重新请求一次并立即恢复。
    assert.equal(calls, failedCalls + 1);

    const cached = await service.catalog('knowledge_chat', [provider]);
    assert.equal(cached.providers[0].catalogAvailable, true);
    // 成功结果命中缓存，不再产生新的供应商请求。
    assert.equal(calls, failedCalls + 1);
  });

  it('refuses to bind a third-party model to the provider that merely hosts it', async () => {
    // 百炼目录里会出现它托管的 DeepSeek 模型，但把它绑到百炼连接上请求必然失败。
    const service = new ModelCatalogService({
      fetch: async () =>
        Response.json(
          modelList([
            model({ model: 'qwen3.5-omni-flash' }),
            model({ model: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }),
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

    assert.equal(
      await service.isSelectableModel('knowledge_chat', provider, 'deepseek-v4-flash', null),
      false,
    );
    assert.equal(
      await service.isSelectableModel('knowledge_chat', provider, 'qwen3.5-omni-flash', null),
      true,
    );
    // 已有绑定保持可用，避免升级后把历史配置锁死。
    assert.equal(
      await service.isSelectableModel(
        'knowledge_chat',
        provider,
        'deepseek-v4-flash',
        'deepseek-v4-flash',
      ),
      true,
    );
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
    // DeepSeek 连接不提供百炼的默认模型，因此绝不把它置顶，只列出自己真实可用的模型。
    assert.deepEqual(
      result.providers.flatMap((provider) => provider.models.map((item) => item.id)),
      ['deepseek-v4-flash'],
    );
    assert.equal(result.providers[0].defaultModel, null);
    assert.equal(
      result.providers[0].models.some((item) => item.id === 'qwen3.5-omni-flash'),
      false,
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

  it('never pins the Qwen default onto a DeepSeek connection for any text capability', async () => {
    const service = new ModelCatalogService({
      fetch: async () => {
        throw new Error('must not call the network for DeepSeek');
      },
    });
    const provider = {
      connectionId: deepSeekProvider.id,
      providerType: 'deepseek',
      name: 'DeepSeek',
      config: { baseUrl: 'https://api.deepseek.com' },
      credential: { apiKey: 'secret-key' },
    };

    // 情绪能力只允许百炼连接（providers 列表会把它过滤掉），因此只检查 DeepSeek 可作为
    // 备选方案的文本能力。
    const textCapabilities = [
      'knowledge_chat',
      'audio_role',
      'audio_speaker_review',
      'business_analysis',
    ];
    const emotionCatalog = await service.catalog('audio_emotion', [provider]);
    assert.deepEqual(emotionCatalog.providers, []);

    for (const capability of textCapabilities) {
      const catalog = await service.catalog(capability, [provider]);
      assert.equal(catalog.providers[0].catalogAvailable, true);
      assert.deepEqual(
        catalog.providers[0].models.map((item) => item.id),
        ['deepseek-v4-flash'],
        `${capability} must not offer the Qwen default on DeepSeek`,
      );
      assert.equal(catalog.providers[0].defaultModel, null);
    }
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
    // 同一个能力下两个供应商各列自己的模型：DeepSeek 不会出现百炼的默认模型。
    assert.ok(result.providers[0].models.some((item) => item.id === 'qwen3.5-omni-flash'));
    assert.deepEqual(
      result.providers[1].models.map((item) => item.id),
      ['deepseek-v4-flash'],
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

  it('reports an unavailable catalog with a non-secret diagnostic when the provider cannot be reached', async () => {
    const service = new ModelCatalogService({
      fetch: async () => {
        throw new Error('network down');
      },
    });
    const catalogService = settingsService([dashScopeProvider()], service);

    const result = await catalogService.modelCatalogFor('knowledge_chat');

    assert.equal(result.providers[0].catalogAvailable, false);
    // 原因只包含安全的粗粒度诊断，便于用户判断是网络、超时还是上游状态码。
    assert.match(
      result.providers[0].unavailableReason,
      /^暂时无法读取该供应商的模型列表（.+），请稍后重试。$/,
    );
    assert.equal(result.providers[0].unavailableReason.includes('network down'), false);
    // 列表读不出来时仍保留已验证的默认模型，保证首次配置可以完成。
    assert.equal(result.providers[0].defaultModel, 'qwen3.5-omni-flash');
    assert.deepEqual(
      result.providers[0].models.map((item) => item.id),
      ['qwen3.5-omni-flash'],
    );
    assert.equal(result.providers[0].models[0].verified, true);
  });
});
