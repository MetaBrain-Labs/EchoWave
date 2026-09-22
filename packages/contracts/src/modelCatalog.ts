/**
 * 模型目录网络契约与责任规则。
 *
 * 定义按能力筛选的候选模型结构、百炼与 DeepSeek 模型列表的解码规则，以及每个 AI 能力
 * 允许绑定的供应商与模型责任。
 *
 * Responsibilities:
 * - 保证 API 与移动端对模型列表、价格和上下文长度的 wire shape 一致。
 * - 提供唯一的“能力 → 供应商与模型责任”映射，供服务端校验和客户端过滤共同使用。
 *
 * Notes:
 * - 价格与上下文长度是供应商列表接口的展示快照，不参与计费计算，也不写入业务表。
 */
import { z } from 'zod';

import type { AiCapability, ProviderType } from './settings.ts';

/** 百炼模型列表接口使用的模型类型取值，与请求参数 capabilities 一致。 */
export const ModelCapabilitySchema = z.enum([
  'Reasoning',
  'VU',
  'IG',
  'VG',
  'ASR',
  'TTS',
  'ME',
  'Realtime-Omni',
  'Multimodal-Omni',
  'Realtime-Text-to-Speech',
  'TG',
  'TR',
  'Realtime-ASR',
  'Realtime-Audio-Translate',
  '3D-generation',
  'Realtime-Chatting',
]);

/** 模型输入与输出模态，与列表接口 inference_metadata 取值一致。 */
export const ModelModalitySchema = z.enum(['Text', 'Image', 'Audio', 'Video']);

/** 模型支持的能力特性，与列表接口 features 取值一致。 */
export const ModelFeatureSchema = z.enum([
  'model-experience',
  'function-calling',
  'structured-outputs',
  'web-search',
  'prefix-completion',
  'cache',
  'batch',
  'fine-tuning',
]);

export const ModelPriceEntrySchema = z
  .object({
    type: z.string().min(1),
    name: z.string().min(1).nullable(),
    amount: z.number().nonnegative().nullable(),
    unit: z.string().min(1).nullable(),
    range: z.string().min(1).nullable(),
  })
  .strict();

export const ModelPricingSchema = z
  .object({
    currency: z.enum(['CNY', 'USD']),
    entries: z.array(ModelPriceEntrySchema),
  })
  .strict();

export const ProviderModelSummarySchema = z
  .object({
    id: z.string().min(1).max(160),
    displayName: z.string().min(1).max(200),
    description: z.string().max(500),
    capabilities: z.array(ModelCapabilitySchema),
    features: z.array(ModelFeatureSchema),
    contextWindow: z.number().int().positive().nullable(),
    maxOutputTokens: z.number().int().positive().nullable(),
    /** 向量模型声明的输出维度；非向量模型或供应商未声明时为 null。 */
    outputDimensions: z.number().int().positive().nullable(),
    pricing: ModelPricingSchema.nullable(),
    /** 服务端推测的适配提示，例如支持结构化输出，仅用于排序。 */
    recommended: z.boolean(),
    /** true 表示该模型在本仓库已验证可用，选择器固定置顶并标注。 */
    verified: z.boolean(),
  })
  .strict();

export const ProviderModelCatalogSchema = z
  .object({
    connectionId: z.string().uuid(),
    providerType: z.enum(['dashscope', 'deepseek']),
    name: z.string().min(1),
    /** false 表示本次未能从供应商读取列表，models 为空且不可视为“没有可用模型”。 */
    catalogAvailable: z.boolean(),
    /** 目录不可用时给出的安全原因，不包含凭据或供应商响应体。 */
    unavailableReason: z.string().min(1).nullable(),
    defaultModel: z.string().min(1).max(160).nullable(),
    models: z.array(ProviderModelSummarySchema),
  })
  .strict();

export const ModelCatalogResponseSchema = z
  .object({
    capability: z.string().min(1),
    providers: z.array(ProviderModelCatalogSchema),
  })
  .strict();

export const ModelCatalogQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    model: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;
export type ModelModality = z.infer<typeof ModelModalitySchema>;
export type ModelFeature = z.infer<typeof ModelFeatureSchema>;
export type ModelPriceEntry = z.infer<typeof ModelPriceEntrySchema>;
export type ModelPricing = z.infer<typeof ModelPricingSchema>;
export type ProviderModelSummary = z.infer<typeof ProviderModelSummarySchema>;
export type ProviderModelCatalog = z.infer<typeof ProviderModelCatalogSchema>;
export type ModelCatalogResponse = z.infer<typeof ModelCatalogResponseSchema>;
export type ModelCatalogQuery = z.infer<typeof ModelCatalogQuerySchema>;

/** 每个 AI 能力允许的供应商与模型责任。 */
export type CapabilityModelRequirement = {
  /** 允许绑定的供应商类型，顺序即默认优先级。 */
  providers: readonly ProviderType[];
  /** 供应商列表接口的模型类型过滤条件（仅对可查询列表的供应商生效）。 */
  capabilities: readonly ModelCapability[];
  /** 输入模态约束，用于排除不具备音频输入的全模态模型选择。 */
  requiredInputModalities: readonly ModelModality[];
  /**
   * true 表示该能力只接受共享默认模型（OSS 后端）。
   *
   * 需要用户自行承担模型适配责任的能力（Embedding、ASR）也放开改选，但由
   * `verifiedModelIds` 与运行时不变量共同兜底。
   */
  fixedModel: boolean;
  /**
   * 运行时不变量已在本仓库验证过的模型。
   *
   * 目录列出的其他模型仍然可见可搜索，但不能通过绑定时校验：这些能力的时间戳、
   * 说话人分离或向量维度契约无法从模型列表接口推断。
   */
  verifiedModelIds: readonly string[];
  /** 需要结构化 JSON 输出的能力优先推荐支持 structured-outputs 的模型。 */
  prefersStructuredOutput: boolean;
};

/** 能力到模型责任的权威映射，未列出的能力按固定模型处理。 */
export const CAPABILITY_MODEL_REQUIREMENTS: Readonly<
  Record<AiCapability, CapabilityModelRequirement>
> = {
  // 向量维度写死在 pgvector 列类型中，绑定时只接受输出维度等于 1024 的模型。
  knowledge_embedding: {
    providers: ['dashscope'],
    capabilities: ['TR'],
    requiredInputModalities: [],
    fixedModel: false,
    verifiedModelIds: ['qwen3.7-text-embedding'],
    prefersStructuredOutput: false,
  },
  // 重排使用百炼 Workspace 原生接口，协议与模型均固定，避免误选兼容接口模型。
  knowledge_rerank: {
    providers: ['dashscope'],
    capabilities: [],
    requiredInputModalities: [],
    fixedModel: true,
    verifiedModelIds: ['qwen3.7-text-rerank'],
    prefersStructuredOutput: false,
  },
  knowledge_chat: {
    providers: ['dashscope', 'deepseek'],
    capabilities: ['TG'],
    requiredInputModalities: [],
    fixedModel: false,
    verifiedModelIds: [],
    prefersStructuredOutput: true,
  },
  // 转写协议要求 diarization 与词级时间戳，因此只接受已验证的整文件转写模型。
  audio_transcription: {
    providers: ['dashscope'],
    capabilities: ['ASR'],
    requiredInputModalities: [],
    fixedModel: false,
    verifiedModelIds: ['qwen-audio-3.0-asr-flash-filetrans'],
    prefersStructuredOutput: false,
  },
  audio_emotion: {
    providers: ['dashscope'],
    capabilities: ['TG'],
    requiredInputModalities: ['Audio'],
    fixedModel: false,
    verifiedModelIds: [],
    prefersStructuredOutput: false,
  },
  audio_role: {
    providers: ['dashscope', 'deepseek'],
    capabilities: ['TG'],
    requiredInputModalities: [],
    fixedModel: false,
    verifiedModelIds: [],
    prefersStructuredOutput: true,
  },
  audio_speaker_review: {
    providers: ['dashscope', 'deepseek'],
    capabilities: ['TG'],
    requiredInputModalities: [],
    fixedModel: false,
    verifiedModelIds: [],
    prefersStructuredOutput: true,
  },
  business_analysis: {
    providers: ['dashscope', 'deepseek'],
    capabilities: ['TG'],
    requiredInputModalities: [],
    fixedModel: false,
    verifiedModelIds: [],
    prefersStructuredOutput: true,
  },
  audio_staging: {
    providers: ['aliyun_oss'],
    capabilities: [],
    requiredInputModalities: [],
    fixedModel: true,
    verifiedModelIds: ['aliyun-oss'],
    prefersStructuredOutput: false,
  },
  audio_primary_storage: {
    providers: ['aliyun_oss'],
    capabilities: [],
    requiredInputModalities: [],
    fixedModel: true,
    verifiedModelIds: ['aliyun-oss'],
    prefersStructuredOutput: false,
  },
};

const parseResult = z
  .object({
    success: z.boolean().nullable().optional(),
    code: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    // 不同部署可能返回 OpenAI 形态的 data[] 或百炼形态的 output.models[]，两者都要容忍。
    data: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    output: z
      .object({
        models: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

/** 把一条原始条目规范为统一记录：OpenAI 形态用 id，百炼形态用 model。 */
function modelRow(row: Record<string, unknown>): { id: string; record: Record<string, unknown> } {
  const rawId = typeof row.model === 'string' ? row.model : row.id;
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  return { id, record: id && row.model !== id ? { ...row, model: id } : row };
}

/** 单条价格转换为展示条目；畸形价格被丢弃而不是让整页目录失败。 */
function priceEntries(value: unknown): ModelPriceEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ModelPriceEntry[] = [];
  for (const group of value) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    const record = group as Record<string, unknown>;
    const range = typeof record.range_name === 'string' ? record.range_name : null;
    const rows = Array.isArray(record.prices) ? record.prices : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const price = row as Record<string, unknown>;
      const type = typeof price.type === 'string' ? price.type : undefined;
      if (!type) continue;
      const rawAmount = typeof price.price === 'string' ? Number(price.price) : price.price;
      entries.push({
        type,
        name: typeof price.price_name === 'string' ? price.price_name : null,
        amount:
          typeof rawAmount === 'number' && Number.isFinite(rawAmount) && rawAmount >= 0
            ? rawAmount
            : null,
        unit: typeof price.price_unit === 'string' ? price.price_unit : null,
        range,
      });
    }
  }
  return entries;
}

function capabilityList(value: unknown): ModelCapability[] {
  if (!Array.isArray(value)) return [];
  const parsed = value.flatMap((item) => {
    const result = ModelCapabilitySchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
  return [...new Set(parsed)];
}

function featureList(value: unknown): ModelFeature[] {
  if (!Array.isArray(value)) return [];
  const parsed = value.flatMap((item) => {
    const result = ModelFeatureSchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
  return [...new Set(parsed)];
}

function modalityList(value: unknown): ModelModality[] {
  if (!Array.isArray(value)) return [];
  const parsed = value.flatMap((item) => {
    const result = ModelModalitySchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
  return [...new Set(parsed)];
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function satisfiesRequirement(
  model: ProviderModelSummary,
  inputModalities: readonly ModelModality[],
  requirement: CapabilityModelRequirement,
): boolean {
  // 供应商没有返回能力元数据时（例如 OpenAI 形态的 /models）不做能力排除，只按本地
  // 责任规则兜底：缺少元数据不等于模型不具备该能力。
  if (
    model.capabilities.length > 0 &&
    requirement.capabilities.some((capability) => !model.capabilities.includes(capability))
  ) {
    return false;
  }
  if (inputModalities.length === 0) return true;
  return requirement.requiredInputModalities.every((modality) =>
    inputModalities.includes(modality),
  );
}
/**
 * 解码百炼模型列表响应，并按能力责任过滤出可用于该能力的模型。
 *
 * 过滤只在供应商确实返回了对应元数据时生效：缺少能力或模态字段时保留条目，交由服务端
 * 的已验证白名单与用户自行确认兜底，避免因为元数据缺失把整个能力目录清空。
 */
export function decodeDashScopeModelList(
  payload: unknown,
  requirement: CapabilityModelRequirement,
): ProviderModelSummary[] {
  const parsed = parseResult.safeParse(payload);
  // 优先使用百炼形态；只有它缺席时才退回 OpenAI 形态，避免混入不相关信息。
  const rows = parsed.success ? (parsed.data.output?.models ?? parsed.data.data ?? []) : [];
  const models: ProviderModelSummary[] = [];
  for (const raw of rows) {
    const { id, record } = modelRow(raw as Record<string, unknown>);
    if (!id) continue;
    const inference = (record.inference_metadata ?? {}) as Record<string, unknown>;
    const modelInfo = (record.model_info ?? {}) as Record<string, unknown>;
    const responseModalities = modalityList(inference.response_modality);
    const inputModalities = modalityList(inference.request_modality);
    // 只排除明确声明为非文本输出的模型（图片、视频、语音合成等）。
    if (responseModalities.length > 0 && !responseModalities.includes('Text')) continue;
    const capabilities = capabilityList(record.capabilities);
    const features = featureList(record.features);
    const candidate: ProviderModelSummary = {
      id,
      displayName: text(record, 'name') || id,
      description: text(record, 'description'),
      capabilities,
      features,
      contextWindow: positiveInteger(modelInfo.context_window),
      maxOutputTokens: positiveInteger(modelInfo.max_output_tokens),
      outputDimensions: positiveInteger(modelInfo.output_dimensions),
      pricing: null,
      recommended: requirement.prefersStructuredOutput
        ? features.includes('structured-outputs')
        : false,
      verified: requirement.verifiedModelIds.includes(id),
    };
    if (capabilities.length > 0 && !satisfiesRequirement(candidate, inputModalities, requirement)) {
      continue;
    }
    const entries = priceEntries(record.prices);
    models.push(
      entries.length > 0
        ? { ...candidate, pricing: { currency: 'CNY' as const, entries } }
        : candidate,
    );
  }
  return models;
}

/** 解码 DeepSeek 兼容的 OpenAI 模型列表响应。 */
export function decodeDeepSeekModelList(payload: unknown): ProviderModelSummary[] {
  const parsed = parseResult.safeParse(payload);
  const rows = parsed.success ? (parsed.data.data ?? []) : [];
  const models: ProviderModelSummary[] = [];
  for (const row of rows) {
    const { id } = modelRow(row);
    if (!id) continue;
    models.push({
      id,
      displayName: id,
      description: '',
      capabilities: [],
      features: [],
      contextWindow: null,
      maxOutputTokens: null,
      outputDimensions: null,
      pricing: null,
      recommended: false,
      verified: false,
    });
  }
  return models;
}
