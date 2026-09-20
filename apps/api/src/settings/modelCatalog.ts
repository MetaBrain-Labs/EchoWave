/**
 * 供应商模型目录查询。
 *
 * 通过供应商官方模型列表接口读取可用模型，并按能力的模型责任过滤出可绑定候选。
 *
 * Responsibilities:
 * - 解析百炼 /api/v1/models 与 OpenAI 兼容 /models 响应，映射为共享契约的展示结构。
 * - 对成功结果做短期内存缓存，避免管理页面反复调用供应商接口。
 *
 * Notes:
 * - 目录只用于配置选择与绑定校验，不参与运行时模型调用。
 * - 失败原因不会包含 API Key、鉴权头或供应商原始响应体。
 */
import {
  AI_CAPABILITY_DEFAULTS,
  CAPABILITY_MODEL_REQUIREMENTS,
  ModelCatalogQuerySchema,
  ModelCatalogResponseSchema,
  ProviderModelCatalogSchema,
  decodeDashScopeModelList,
  type AiCapability,
  type ModelCatalogQuery,
  type ModelCatalogResponse,
  type ProviderConnectionWrite,
  type ProviderModelCatalog,
  type ProviderModelSummary,
  type ProviderType,
} from '@echowave/contracts';

import type { CredentialBundle } from './types.ts';

/** 参与目录查询的供应商连接快照，不包含 Credential 明文以外的任何状态。 */
export type CatalogProviderInput = {
  connectionId: string;
  providerType: ProviderType;
  name: string;
  config: ProviderConnectionWrite['config'];
  credential: CredentialBundle;
};

export type ModelCatalogOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

/** DeepSeek 连接可绑定的文本模型清单；该方案是成本备选，不做列表接口查询。 */
export const DEEPSEEK_MODEL_CATALOG = ['deepseek-v4-flash'] as const;

/** 单次目录响应的默认候选数量。 */
export const MODEL_CATALOG_DEFAULT_LIMIT = 60;

const MAX_PAGES = 3;
const PAGE_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const CATALOG_UNAVAILABLE_REASON = '暂时无法读取该供应商的模型列表，请稍后重试。';

type CacheEntry = { expiresAt: number; models: ProviderModelSummary[] };

function staticSummary(model: string, description: string): ProviderModelSummary {
  return {
    id: model,
    displayName: model,
    description,
    capabilities: [],
    features: [],
    contextWindow: null,
    maxOutputTokens: null,
    pricing: null,
    recommended: false,
  };
}

function apiKeyOf(credential: CredentialBundle): string | undefined {
  return 'apiKey' in credential ? credential.apiKey : undefined;
}

/** 依据供应商返回的分页元数据判断是否还有下一页；缺失时按“已取完”处理。 */
function hasNextPage(payload: unknown, page: number): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const output = (payload as { output?: unknown }).output;
  if (!output || typeof output !== 'object') return false;
  const total = (output as { total?: unknown }).total;
  const pageSize = (output as { page_size?: unknown }).page_size;
  if (typeof total !== 'number' || typeof pageSize !== 'number' || pageSize <= 0) return false;
  return page * pageSize < total;
}

/**
 * 读取并缓存供应商模型目录。
 *
 * 每个连接只保留最近一次成功结果；拉取失败不写入缓存，并在下一次请求时重试。
 */
export class ModelCatalogService {
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<ProviderModelSummary[]>>();

  constructor(options: ModelCatalogOptions = {}) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** 返回该能力的全部候选连接目录；单个连接失败只影响它自己。 */
  async catalog(
    capability: AiCapability,
    providers: readonly CatalogProviderInput[],
    query: ModelCatalogQuery = {},
  ): Promise<ModelCatalogResponse> {
    const requirement = CAPABILITY_MODEL_REQUIREMENTS[capability];
    const parsedQuery = ModelCatalogQuerySchema.parse(query);
    const candidates = providers.filter((provider) =>
      (requirement.providers as readonly ProviderType[]).includes(provider.providerType),
    );
    const catalogs = await Promise.all(
      candidates.map((provider) => this.providerCatalog(provider, capability, parsedQuery)),
    );
    return ModelCatalogResponseSchema.parse({ capability, providers: catalogs });
  }

  /**
   * 判断模型是否属于该连接在该能力下的有效候选。
   *
   * 目录可用时做严格校验；目录不可用时返回 undefined，由调用方决定如何降级，绝不静默放行。
   */
  async isSelectableModel(
    capability: AiCapability,
    provider: CatalogProviderInput,
    model: string,
  ): Promise<boolean | undefined> {
    if (CAPABILITY_MODEL_REQUIREMENTS[capability].fixedModel) {
      return model === AI_CAPABILITY_DEFAULTS[capability].model;
    }
    if (provider.providerType === 'deepseek') {
      return (DEEPSEEK_MODEL_CATALOG as readonly string[]).includes(model);
    }
    const models = await this.models(capability, provider);
    if (!models) return undefined;
    return models.some((candidate) => candidate.id === model);
  }

  private async providerCatalog(
    provider: CatalogProviderInput,
    capability: AiCapability,
    query: ModelCatalogQuery,
  ): Promise<ProviderModelCatalog> {
    const requirement = CAPABILITY_MODEL_REQUIREMENTS[capability];
    const capabilityDefault = AI_CAPABILITY_DEFAULTS[capability].model;
    if (requirement.fixedModel) {
      return ProviderModelCatalogSchema.parse({
        connectionId: provider.connectionId,
        providerType: provider.providerType,
        name: provider.name,
        catalogAvailable: true,
        unavailableReason: null,
        defaultModel: capabilityDefault,
        models: [staticSummary(capabilityDefault, '该能力的模型由服务端固定，不支持改选。')],
      });
    }
    try {
      const all = await this.models(capability, provider);
      if (!all) throw new Error('model-catalog-unavailable');
      const models = query.model
        ? all.filter((candidate) => candidate.id === query.model)
        : all.slice(0, query.limit ?? MODEL_CATALOG_DEFAULT_LIMIT);
      return ProviderModelCatalogSchema.parse({
        connectionId: provider.connectionId,
        providerType: provider.providerType,
        name: provider.name,
        catalogAvailable: true,
        unavailableReason: null,
        defaultModel: all.some((candidate) => candidate.id === capabilityDefault)
          ? capabilityDefault
          : null,
        models,
      });
    } catch {
      return ProviderModelCatalogSchema.parse({
        connectionId: provider.connectionId,
        providerType: provider.providerType,
        name: provider.name,
        catalogAvailable: false,
        unavailableReason: CATALOG_UNAVAILABLE_REASON,
        defaultModel: null,
        models: [],
      });
    }
  }

  /** 读取候选模型；undefined 表示目录不可用。 */
  private async models(
    capability: AiCapability,
    provider: CatalogProviderInput,
  ): Promise<ProviderModelSummary[] | undefined> {
    if (provider.providerType === 'deepseek') {
      return DEEPSEEK_MODEL_CATALOG.map((model) =>
        staticSummary(model, 'DeepSeek 官方 API 模型，缓存命中价格低于百炼同名模型。'),
      );
    }
    const key = `${provider.connectionId}:${capability}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.models;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const pending = this.fetchDashScopeModels(capability, provider).then((models) => {
      this.cache.set(key, { expiresAt: this.now() + CACHE_TTL_MS, models });
      return models;
    });
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } catch {
      return undefined;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async fetchDashScopeModels(
    capability: AiCapability,
    provider: CatalogProviderInput,
  ): Promise<ProviderModelSummary[]> {
    const requirement = CAPABILITY_MODEL_REQUIREMENTS[capability];
    const apiKey = apiKeyOf(provider.credential);
    if (!apiKey) throw new Error('model-catalog-credential-missing');
    const baseUrl = (provider.config as { baseUrl?: string }).baseUrl;
    if (!baseUrl) throw new Error('model-catalog-endpoint-missing');
    const collected = new Map<string, ProviderModelSummary>();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = new URL(`${baseUrl.replace(/\/$/, '')}/models`);
      for (const value of requirement.capabilities) {
        url.searchParams.append('capabilities', value);
      }
      url.searchParams.append('supports', 'inference');
      url.searchParams.set('language', 'zh-CN');
      url.searchParams.set('page_no', String(page));
      url.searchParams.set('page_size', String(PAGE_SIZE));
      const response = await this.fetchImplementation(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`model-catalog-${response.status}`);
      const payload: unknown = await response.json();
      const decoded = decodeDashScopeModelList(payload, requirement);
      for (const model of decoded) {
        if (!collected.has(model.id)) collected.set(model.id, model);
      }
      // 只有供应商声明还有下一页时才继续翻页，避免把“本页已取完”误判为需要重试。
      if (!hasNextPage(payload, page)) break;
    }
    if (collected.size === 0) throw new Error('model-catalog-empty');
    return [...collected.values()].sort(
      (left, right) =>
        Number(right.recommended) - Number(left.recommended) || left.id.localeCompare(right.id),
    );
  }
}
