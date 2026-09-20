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
  type CapabilityModelRequirement,
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

/** 目录不可用时的安全错误：保留上游状态码便于排查，但不携带响应体或凭据。 */
class CatalogFetchError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = 'CatalogFetchError';
  }
}

function unavailableReason(error: unknown): string {
  const detail = error instanceof CatalogFetchError ? error.detail : undefined;
  return detail
    ? `暂时无法读取该供应商的模型列表（${detail}），请稍后重试。`
    : '暂时无法读取该供应商的模型列表，请稍后重试。';
}

type CacheEntry = { expiresAt: number; models: ProviderModelSummary[] };

function staticSummary(
  model: string,
  description: string,
  verified: boolean,
): ProviderModelSummary {
  return {
    id: model,
    displayName: model,
    description,
    capabilities: [],
    features: [],
    contextWindow: null,
    maxOutputTokens: null,
    outputDimensions: null,
    pricing: null,
    recommended: false,
    verified,
  };
}

/** 置顶项：能力默认模型即使不在供应商列表中，也始终排在第一并标记为已验证。 */
function defaultSummary(
  capability: AiCapability,
  description: string,
  fromCatalog: ProviderModelSummary | undefined,
): ProviderModelSummary {
  const fallback = staticSummary(AI_CAPABILITY_DEFAULTS[capability].model, description, true);
  return fromCatalog
    ? { ...fallback, ...fromCatalog, verified: true }
    : { ...fallback, verified: true };
}

/**
 * 该连接是否有可能提供这个能力默认模型。
 *
 * 供应商列表可能被能力筛选过滤掉默认模型，因此“不在返回结果里”不等于不支持；但如果连
 * 供应商自己的静态清单都不包含它，就绝不能置顶——否则会给 DeepSeek 之类的连接挂上一个
 * 它根本调用不了的百炼模型。
 */
function providerCanServeDefault(
  capability: AiCapability,
  providerType: ProviderType,
  models: readonly ProviderModelSummary[],
): boolean {
  const defaultModel = AI_CAPABILITY_DEFAULTS[capability].model;
  if (models.some((model) => model.id === defaultModel)) return true;
  if (providerType === 'deepseek') {
    return (DEEPSEEK_MODEL_CATALOG as readonly string[]).includes(defaultModel);
  }
  // 百炼：只有该能力的默认模型确实托管在百炼时才置顶。
  return Object.values(AI_CAPABILITY_DEFAULTS).some(
    (defaults) => defaults.providerType === 'dashscope' && defaults.model === defaultModel,
  );
}

/**
 * 把能力默认模型固定置于首位并标记已验证。
 *
 * 仅在当前连接确实能提供该模型时置顶；否则保持供应商真实列表，避免出现一个无法调用的
 * “默认模型”。
 */
function withPinnedDefault(
  capability: AiCapability,
  providerType: ProviderType,
  models: readonly ProviderModelSummary[],
): ProviderModelSummary[] {
  const defaultModel = AI_CAPABILITY_DEFAULTS[capability].model;
  const ranked = models.filter((model) => model.id !== defaultModel);
  if (!providerCanServeDefault(capability, providerType, models)) {
    return models.map((model) => ({ ...model, verified: false }));
  }
  const pinned = defaultSummary(
    capability,
    '本仓库已验证可用：默认模型，保持向量维度、说话人分离与时间戳契约。',
    models.find((model) => model.id === defaultModel),
  );
  return [pinned, ...ranked.map((model) => ({ ...model, verified: false }))];
}

function apiKeyOf(credential: CredentialBundle): string | undefined {
  return 'apiKey' in credential ? credential.apiKey : undefined;
}

/**
 * 判断模型是否属于另一个已知供应商。
 *
 * 供应商目录里会同时出现第三方托管模型（例如百炼上的 DeepSeek），把它绑定到别家连接后
 * 端点仍会建立，但请求必然失败，因此这种情况要在绑定时就拒绝。
 */
function isForeignModel(
  model: string,
  providerType: ProviderType,
  models: readonly ProviderModelSummary[],
): boolean {
  if (providerType === 'deepseek') return false;
  if (!model.toLowerCase().includes('deepseek')) return false;
  return models.some((candidate) => candidate.id === model);
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
  private readonly failures = new Map<string, string>();

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
   * 未被验证的模型即使出现在供应商目录里也不允许绑定：时间戳、说话人分离与向量维度
   * 契约无法从模型列表接口推断，需要本仓库先完成适配。
   */
  async isSelectableModel(
    capability: AiCapability,
    provider: CatalogProviderInput,
    model: string,
    currentModel?: string | null,
  ): Promise<boolean | undefined> {
    const requirement = CAPABILITY_MODEL_REQUIREMENTS[capability];
    if (requirement.fixedModel) {
      return model === AI_CAPABILITY_DEFAULTS[capability].model;
    }
    // 本仓库已验证的模型永远可保存，不受供应商列表可用性影响。
    if (requirement.verifiedModelIds.includes(model)) return true;
    // 保持现状：绑定未改动，或仍是该能力的默认模型时无需重新校验。
    const keepsCurrent =
      currentModel === model || model === AI_CAPABILITY_DEFAULTS[capability].model;
    if (provider.providerType === 'deepseek') {
      return (DEEPSEEK_MODEL_CATALOG as readonly string[]).includes(model);
    }
    const models = await this.models(capability, provider);
    if (models && isForeignModel(model, provider.providerType, models) && !keepsCurrent) {
      // 例如把 DeepSeek 的模型绑定到百炼连接：端点能建，但请求一定失败。
      return false;
    }
    // 目录不可用时只放行“保持现状”，其余模型由调用方以 MODEL_UNAVAILABLE 提示重试。
    if (!models) return keepsCurrent ? true : undefined;
    if (!models.some((candidate) => candidate.id === model)) return false;
    // 目录里存在但尚未适配：只允许保持已有绑定，不允许新选择。
    return keepsCurrent;
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
        models: [defaultSummary(capability, '该能力使用固定的服务端后端，不支持改选。', undefined)],
      });
    }
    try {
      const all = await this.models(capability, provider);
      if (!all) {
        throw new CatalogFetchError(this.failureReason(capability, provider) ?? '未收到模型列表');
      }
      const pinned = withPinnedDefault(capability, provider.providerType, all);
      const limit = query.limit ?? MODEL_CATALOG_DEFAULT_LIMIT;
      // 置顶项固定在首位，其余候选按剩余额度截断，避免默认模型挤掉一个候选。
      const models = query.model
        ? pinned.filter((candidate) => candidate.id === query.model)
        : pinned.slice(0, limit);
      return ProviderModelCatalogSchema.parse({
        connectionId: provider.connectionId,
        providerType: provider.providerType,
        name: provider.name,
        catalogAvailable: true,
        unavailableReason: null,
        // 默认模型必须是这个连接真能提供的；置顶判定已经覆盖了这一点。
        defaultModel: models.some((candidate) => candidate.verified) ? capabilityDefault : null,
        models,
      });
    } catch (error) {
      // 供应商列表读不出来时，至少保留该能力已验证的默认模型：它不依赖列表接口，
      // 否则用户只能看到一个空弹窗，连开箱可用的配置都无法保存。
      const servesDefault = providerCanServeDefault(capability, provider.providerType, []);
      return ProviderModelCatalogSchema.parse({
        connectionId: provider.connectionId,
        providerType: provider.providerType,
        name: provider.name,
        catalogAvailable: false,
        unavailableReason: unavailableReason(error),
        defaultModel: servesDefault ? capabilityDefault : null,
        models: servesDefault
          ? [
              defaultSummary(
                capability,
                '该模型不依赖供应商列表接口，可在列表读取失败时继续使用。',
                undefined,
              ),
            ]
          : [],
      });
    }
  }

  /**
   * 读取候选模型原始条目；undefined 表示目录不可用。
   *
   * 供绑定校验读取模型声明的输出维度等元数据，不做置顶或截断处理。
   */
  async summariesFor(
    capability: AiCapability,
    provider: CatalogProviderInput,
  ): Promise<ProviderModelSummary[] | undefined> {
    return this.models(capability, provider);
  }

  /** 读取候选模型；undefined 表示目录不可用，原因记录在 failureReason。 */
  private async models(
    capability: AiCapability,
    provider: CatalogProviderInput,
  ): Promise<ProviderModelSummary[] | undefined> {
    if (provider.providerType === 'deepseek') {
      return DEEPSEEK_MODEL_CATALOG.map((model) =>
        staticSummary(model, 'DeepSeek 官方 API 模型，缓存命中价格低于百炼同名模型。', false),
      );
    }
    const key = `${provider.connectionId}:${capability}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.models;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const pending = this.fetchDashScopeModels(capability, provider).then((models) => {
      this.cache.set(key, { expiresAt: this.now() + CACHE_TTL_MS, models });
      this.failures.delete(key);
      return models;
    });
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      // 只登记原因；失败结果不入缓存，下一次请求会真正重试。
      this.failures.set(key, error instanceof CatalogFetchError ? error.detail : '请求失败');
      return undefined;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** 读取该连接在该能力下最近一次失败的安全原因。 */
  failureReason(capability: AiCapability, provider: CatalogProviderInput): string | undefined {
    return this.failures.get(`${provider.connectionId}:${capability}`);
  }

  private async fetchDashScopeModels(
    capability: AiCapability,
    provider: CatalogProviderInput,
  ): Promise<ProviderModelSummary[]> {
    const requirement = CAPABILITY_MODEL_REQUIREMENTS[capability];
    const apiKey = apiKeyOf(provider.credential);
    if (!apiKey) throw new CatalogFetchError('凭据不可用');
    const baseUrl = (provider.config as { baseUrl?: string }).baseUrl;
    if (!baseUrl) throw new CatalogFetchError('未配置 Base URL');
    const endpoint = `${baseUrl.replace(/\/$/, '')}/models`;
    // 供应商列表接口的筛选参数并非所有地域与版本都支持：先带责任筛选请求，失败再退回
    // 最小分页请求，最后退回一次不带分页的请求，任何一次成功都用本地责任规则过滤。
    const attempts = [
      () => this.fetchModelPages(endpoint, apiKey, requirement),
      () => this.fetchModelPages(endpoint, apiKey, requirement, { plain: true }),
      () => this.fetchModelOnce(endpoint, apiKey, requirement),
    ];
    const errors: string[] = [];
    for (const attempt of attempts) {
      try {
        const models = await attempt();
        if (models.length > 0) {
          return models.sort(
            (left, right) =>
              Number(right.recommended) - Number(left.recommended) ||
              left.id.localeCompare(right.id),
          );
        }
        errors.push('未返回可用模型');
      } catch (error) {
        errors.push(error instanceof CatalogFetchError ? error.detail : '请求失败');
      }
    }
    // 优先暴露最有排查价值的失败原因：状态码或网络信息优于“未返回可用模型”。
    const informative = errors.find((detail) => detail !== '未返回可用模型');
    throw new CatalogFetchError(informative ?? errors[0] ?? '请求失败');
  }

  /**
   * 分页读取模型列表。
   *
   * `plain` 模式去掉 capabilities/supports/language 筛选参数，只保留分页，兼容不支持
   * 筛选参数的部署；筛选仍在本地按能力责任完成。
   */
  private async fetchModelPages(
    endpoint: string,
    apiKey: string,
    requirement: CapabilityModelRequirement,
    options: { plain?: boolean } = {},
  ): Promise<ProviderModelSummary[]> {
    const collected = new Map<string, ProviderModelSummary>();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = new URL(endpoint);
      if (!options.plain) {
        for (const value of requirement.capabilities) {
          url.searchParams.append('capabilities', value);
        }
        url.searchParams.append('supports', 'inference');
      }
      url.searchParams.set('page_no', String(page));
      url.searchParams.set('page_size', String(PAGE_SIZE));
      const payload = await this.requestModelList(url, apiKey);
      for (const model of decodeDashScopeModelList(payload, requirement)) {
        if (!collected.has(model.id)) collected.set(model.id, model);
      }
      // 只有供应商声明还有下一页时才继续翻页，避免把“本页已取完”误判为需要重试。
      if (!hasNextPage(payload, page)) break;
    }
    return [...collected.values()];
  }

  /** 只请求一次模型列表，适用于不接受分页参数的部署。 */
  private async fetchModelOnce(
    endpoint: string,
    apiKey: string,
    requirement: CapabilityModelRequirement,
  ): Promise<ProviderModelSummary[]> {
    const payload = await this.requestModelList(new URL(endpoint), apiKey);
    return decodeDashScopeModelList(payload, requirement);
  }

  private async requestModelList(url: URL, apiKey: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new CatalogFetchError('网络或超时');
    }
    if (!response.ok) throw new CatalogFetchError(`供应商返回 ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new CatalogFetchError('响应不是有效 JSON');
    }
  }
}
