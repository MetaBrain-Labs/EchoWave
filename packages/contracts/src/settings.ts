/**
 * 租户级 AI 配置网络契约。
 *
 * 定义供应商连接、Credential 来源、能力绑定、安全传输状态和旧环境导入的稳定 wire shape。
 *
 * Responsibilities:
 * - 约束 API 与移动端共享的配置管理输入输出。
 * - 保证任何响应都不会包含 Credential 明文。
 *
 * Notes:
 * - 供应商实际调用参数仍由 API 领域服务解析。
 */
import { z } from 'zod';

import { EntityIdSchema } from './common.ts';
import { CAPABILITY_MODEL_REQUIREMENTS } from './modelCatalog.ts';

export const ProviderTypeSchema = z.enum(['dashscope', 'deepseek', 'aliyun_oss']);
export const CredentialSourceSchema = z.enum(['database', 'local_file']);
export const TransportSecurityModeSchema = z.enum([
  'https',
  'localhost',
  'trusted_proxy_https',
  'insecure_remote_http',
]);
export const AiCapabilitySchema = z.enum([
  'knowledge_embedding',
  'knowledge_rerank',
  'knowledge_chat',
  'audio_transcription',
  'audio_emotion',
  'audio_role',
  'audio_speaker_review',
  'business_analysis',
  'audio_staging',
  'audio_primary_storage',
]);

export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export type AiCapability = z.infer<typeof AiCapabilitySchema>;

/** AI 能力默认绑定配置，供 API 校验、旧配置导入和移动端预填共同使用。 */
export type AiCapabilityDefault = {
  providerType: ProviderType;
  model: string;
  settings: Record<string, unknown>;
};

/**
 * 所有受支持 AI 能力的权威默认供应商、模型和运行设置。
 *
 * 默认全部绑定百炼（通义千问），使部署者只配置一个 API Key 即可运行；DeepSeek 连接用于
 * 成本敏感场景下改选相同职责的模型，其缓存命中价格更低。
 */
export const AI_CAPABILITY_DEFAULTS = {
  knowledge_embedding: {
    providerType: 'dashscope',
    model: 'qwen3.7-text-embedding',
    settings: {},
  },
  knowledge_rerank: {
    providerType: 'dashscope',
    model: 'qwen3.7-text-rerank',
    settings: {},
  },
  knowledge_chat: {
    providerType: 'dashscope',
    model: 'qwen3.5-omni-flash',
    settings: { enableThinking: false },
  },
  audio_transcription: {
    providerType: 'dashscope',
    model: 'qwen-audio-3.0-asr-flash-filetrans',
    settings: {},
  },
  audio_emotion: {
    providerType: 'dashscope',
    model: 'qwen3.5-omni-flash',
    settings: {},
  },
  audio_role: {
    providerType: 'dashscope',
    model: 'qwen3.5-omni-flash',
    settings: {},
  },
  audio_speaker_review: {
    providerType: 'dashscope',
    model: 'qwen3.5-omni-flash',
    settings: {},
  },
  business_analysis: {
    providerType: 'dashscope',
    model: 'qwen3.5-omni-flash',
    settings: { enableThinking: false },
  },
  audio_staging: {
    providerType: 'aliyun_oss',
    model: 'aliyun-oss',
    settings: {},
  },
  audio_primary_storage: {
    providerType: 'aliyun_oss',
    model: 'aliyun-oss',
    settings: {},
  },
} as const satisfies Readonly<Record<AiCapability, AiCapabilityDefault>>;

/** 知识库向量维度：pgvector 列类型与检索契约都固定为该值。 */
export const EMBEDDING_DIMENSIONS = 1024 as const;

/** 支持 Thinking 开关的能力，决定能力绑定的 settings 形状。 */
export const THINKING_CAPABILITIES = [
  'knowledge_chat',
  'business_analysis',
] as const satisfies readonly AiCapability[];

export type ThinkingCapability = (typeof THINKING_CAPABILITIES)[number];

/** 判断能力绑定是否接受 enableThinking 运行设置。 */
export function supportsThinkingSetting(
  capability: AiCapability,
): capability is ThinkingCapability {
  return (THINKING_CAPABILITIES as readonly AiCapability[]).includes(capability);
}

/**
 * 每个能力可绑定的供应商类型，顺序即默认优先级。
 *
 * 与模型责任规则同源，避免“默认供应商”与“可选供应商”在两处漂移。
 */
export const AI_CAPABILITY_PROVIDER_PREFERENCES = Object.fromEntries(
  Object.entries(CAPABILITY_MODEL_REQUIREMENTS).map(([capability, requirement]) => [
    capability,
    requirement.providers,
  ]),
) as Readonly<Record<AiCapability, readonly ProviderType[]>>;

const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', {
    message: 'Provider URL must use HTTPS.',
  });

export const DashScopeRegionSchema = z.enum([
  'cn-beijing',
  'ap-southeast-1',
  'ap-northeast-1',
  'eu-central-1',
  'cn-hongkong',
  'us-east-1',
]);

/**
 * 业务空间专属域名的第一个 DNS 标签。
 *
 * 该值取自控制台 API Host 中第一个点之前的部分：早期业务空间是 `llm-…`，较新的业务空间是
 * `ws-…`。百炼没有公开稳定的前缀白名单，因此只能按单段 DNS 标签校验；一旦按固定前缀白名单
 * 校验，新业务空间的正确取值会被判成非法参数，迁移请求直接以 BAD_REQUEST 失败。
 */
export const DashScopeWorkspaceIdSchema = z
  .string()
  .trim()
  .max(63)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Workspace domain prefix must be one lowercase DNS label, for example ws-xxxxxxxx.',
  );

const DashScopeNotifyFields = {
  asyncNotifyMode: z.enum(['polling', 'eventbridge']),
  eventBridgeCallbackUrl: HttpsUrlSchema.nullable(),
} as const;

function validateDashScopeNotifyConfig(
  value: { asyncNotifyMode: 'polling' | 'eventbridge'; eventBridgeCallbackUrl: string | null },
  context: z.RefinementCtx,
) {
  if (value.asyncNotifyMode === 'eventbridge' && !value.eventBridgeCallbackUrl) {
    context.addIssue({
      code: 'custom',
      path: ['eventBridgeCallbackUrl'],
      message: 'EventBridge mode requires a callback URL.',
    });
  }
  if (value.asyncNotifyMode === 'polling' && value.eventBridgeCallbackUrl) {
    context.addIssue({
      code: 'custom',
      path: ['eventBridgeCallbackUrl'],
      message: 'Polling mode must not configure a callback URL.',
    });
  }
}

export const DashScopeConnectionConfigSchema = z
  .object({
    workspaceId: DashScopeWorkspaceIdSchema,
    region: DashScopeRegionSchema.default('cn-beijing'),
    ...DashScopeNotifyFields,
  })
  .strict()
  .superRefine(validateDashScopeNotifyConfig);

/** 仅用于读取历史 revision；新的网络写入不得继续提交独立 URL。 */
export const LegacyDashScopeConnectionConfigSchema = z
  .object({
    baseUrl: HttpsUrlSchema,
    compatibleBaseUrl: HttpsUrlSchema,
    rerankBaseUrl: HttpsUrlSchema.optional(),
    ...DashScopeNotifyFields,
  })
  .strict()
  .superRefine(validateDashScopeNotifyConfig);

export const DashScopeStoredConnectionConfigSchema = z.union([
  DashScopeConnectionConfigSchema,
  LegacyDashScopeConnectionConfigSchema,
]);

export const DashScopeWorkspaceMigrationRequestSchema = z
  .object({
    workspaceId: DashScopeWorkspaceIdSchema,
    region: DashScopeRegionSchema.default('cn-beijing'),
  })
  .strict();

export const DashScopeWorkspaceStatusSchema = z
  .object({
    status: z.enum(['not_configured', 'legacy', 'dedicated', 'mixed']),
    migrationRequired: z.boolean(),
    totalConnectionCount: z.number().int().nonnegative(),
    legacyConnectionCount: z.number().int().nonnegative(),
  })
  .strict();

export const DashScopeWorkspaceMigrationResponseSchema = z
  .object({
    workspace: DashScopeWorkspaceStatusSchema,
    updatedConnectionCount: z.number().int().nonnegative(),
    rerankBindingCreated: z.boolean(),
  })
  .strict();

/** 从业务空间信息派生所有百炼调用地址，禁止各能力自行拼装域名。 */
export function dashScopeWorkspaceEndpoints(input: {
  workspaceId: string;
  region?: z.infer<typeof DashScopeRegionSchema>;
}) {
  const workspaceId = DashScopeWorkspaceIdSchema.parse(input.workspaceId);
  const region = DashScopeRegionSchema.parse(input.region ?? 'cn-beijing');
  const origin = `https://${workspaceId}.${region}.maas.aliyuncs.com`;
  return {
    origin,
    nativeBaseUrl: `${origin}/api/v1`,
    compatibleBaseUrl: `${origin}/compatible-mode/v1`,
  } as const;
}

export const DeepSeekConnectionConfigSchema = z.object({ baseUrl: HttpsUrlSchema }).strict();

export const AliyunOssConnectionConfigSchema = z
  .object({
    region: z.string().regex(/^oss-[a-z0-9-]+$/),
    bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  })
  .strict();

export const ProviderConnectionConfigSchema = z.union([
  DashScopeStoredConnectionConfigSchema,
  DeepSeekConnectionConfigSchema,
  AliyunOssConnectionConfigSchema,
]);

const ProviderConnectionWriteConfigSchema = z.union([
  DashScopeConnectionConfigSchema,
  DeepSeekConnectionConfigSchema,
  AliyunOssConnectionConfigSchema,
]);

export const DashScopeCredentialInputSchema = z
  .object({
    apiKey: z.string().min(1),
    eventBridgeCallbackToken: z.string().min(1).optional(),
  })
  .strict();
export const DeepSeekCredentialInputSchema = z.object({ apiKey: z.string().min(1) }).strict();
export const AliyunOssCredentialInputSchema = z
  .object({ accessKeyId: z.string().min(1), accessKeySecret: z.string().min(1) })
  .strict();
export const CredentialBundleInputSchema = z.union([
  DashScopeCredentialInputSchema,
  DeepSeekCredentialInputSchema,
  AliyunOssCredentialInputSchema,
]);

export const ProviderConnectionWriteSchema = z
  .object({
    type: ProviderTypeSchema,
    name: z.string().trim().min(1).max(80),
    config: ProviderConnectionWriteConfigSchema,
    credentialSource: CredentialSourceSchema,
    localCredentialAlias: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/)
      .optional(),
    credential: CredentialBundleInputSchema.optional(),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedConfig =
      value.type === 'dashscope'
        ? DashScopeConnectionConfigSchema
        : value.type === 'deepseek'
          ? DeepSeekConnectionConfigSchema
          : AliyunOssConnectionConfigSchema;
    if (!expectedConfig.safeParse(value.config).success) {
      context.addIssue({
        code: 'custom',
        path: ['config'],
        message: 'Provider config is invalid.',
      });
    }
    if (value.credentialSource === 'local_file' && !value.localCredentialAlias) {
      context.addIssue({
        code: 'custom',
        path: ['localCredentialAlias'],
        message: 'Local Credential source requires an alias.',
      });
    }
    if (value.credentialSource === 'local_file' && value.credential) {
      context.addIssue({
        code: 'custom',
        path: ['credential'],
        message: 'Local Credential source must not submit a Credential value.',
      });
    }
    if (value.credentialSource === 'database' && value.localCredentialAlias) {
      context.addIssue({
        code: 'custom',
        path: ['localCredentialAlias'],
        message: 'Database Credential source must not reference a local alias.',
      });
    }
  });

export const CredentialDescriptorSchema = z
  .object({
    source: CredentialSourceSchema,
    configured: z.boolean(),
    alias: z.string().nullable(),
    maskedValue: z.string().nullable(),
  })
  .strict();

export const ProviderConnectionSchema = z
  .object({
    id: EntityIdSchema,
    type: ProviderTypeSchema,
    name: z.string(),
    revision: z.number().int().positive(),
    config: ProviderConnectionConfigSchema,
    credential: CredentialDescriptorSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();

export const CapabilityBindingWriteSchema = z
  .object({
    providerConnectionId: EntityIdSchema.nullable(),
    secondaryProviderConnectionId: EntityIdSchema.nullable().default(null),
    model: z.string().min(1).max(160),
    settings: z.record(z.string(), z.unknown()).default({}),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();

export const CapabilityBindingSchema = CapabilityBindingWriteSchema.omit({
  expectedRevision: true,
}).extend({
  capability: AiCapabilitySchema,
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});

export const TransportSecuritySchema = z
  .object({
    mode: TransportSecurityModeSchema,
    secretSubmissionAllowed: z.boolean(),
    warning: z.string().nullable(),
  })
  .strict();

export const LocalCredentialDescriptorSchema = z
  .object({ alias: z.string(), type: ProviderTypeSchema, available: z.boolean() })
  .strict();
export const LocalCredentialProviderStatusSchema = z
  .object({
    configured: z.boolean(),
    healthy: z.boolean(),
    lastLoadedAt: z.string().datetime().nullable(),
    error: z.string().nullable(),
    credentials: z.array(LocalCredentialDescriptorSchema),
  })
  .strict();

export const LegacyConfigurationStatusSchema = z
  .object({
    detectedVariables: z.array(z.string()),
    missingVariables: z.array(z.string()),
    ready: z.boolean(),
    importedAt: z.string().datetime().nullable(),
  })
  .strict();

export const SettingsOverviewSchema = z
  .object({
    transport: TransportSecuritySchema,
    localCredentials: LocalCredentialProviderStatusSchema,
    providers: z.array(ProviderConnectionSchema),
    bindings: z.array(CapabilityBindingSchema),
    legacy: LegacyConfigurationStatusSchema,
  })
  .strict();

export const AdminSessionResponseSchema = z.object({ ok: z.literal(true) }).strict();

export type CredentialSource = z.infer<typeof CredentialSourceSchema>;
export type TransportSecurityMode = z.infer<typeof TransportSecurityModeSchema>;
export type DashScopeRegion = z.infer<typeof DashScopeRegionSchema>;
export type DashScopeConnectionConfig = z.infer<typeof DashScopeConnectionConfigSchema>;
export type LegacyDashScopeConnectionConfig = z.infer<typeof LegacyDashScopeConnectionConfigSchema>;
export type DashScopeStoredConnectionConfig = z.infer<typeof DashScopeStoredConnectionConfigSchema>;
export type DashScopeWorkspaceMigrationRequest = z.infer<
  typeof DashScopeWorkspaceMigrationRequestSchema
>;
export type DashScopeWorkspaceStatus = z.infer<typeof DashScopeWorkspaceStatusSchema>;
export type DashScopeWorkspaceMigrationResponse = z.infer<
  typeof DashScopeWorkspaceMigrationResponseSchema
>;
export type ProviderConnectionWrite = z.infer<typeof ProviderConnectionWriteSchema>;
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;
export type CapabilityBindingWrite = z.infer<typeof CapabilityBindingWriteSchema>;
export type CapabilityBinding = z.infer<typeof CapabilityBindingSchema>;
export type SettingsOverview = z.infer<typeof SettingsOverviewSchema>;
export type CredentialBundleInput = z.infer<typeof CredentialBundleInputSchema>;
export type LocalCredentialProviderStatus = z.infer<typeof LocalCredentialProviderStatusSchema>;

export { CAPABILITY_MODEL_REQUIREMENTS, type CapabilityModelRequirement } from './modelCatalog.ts';
