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
  'knowledge_chat',
  'audio_transcription',
  'audio_emotion',
  'audio_role',
  'business_analysis',
  'audio_staging',
]);

const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', {
    message: 'Provider URL must use HTTPS.',
  });

export const DashScopeConnectionConfigSchema = z
  .object({
    baseUrl: HttpsUrlSchema,
    compatibleBaseUrl: HttpsUrlSchema,
    asyncNotifyMode: z.enum(['polling', 'eventbridge']),
    eventBridgeCallbackUrl: HttpsUrlSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
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
  });

export const DeepSeekConnectionConfigSchema = z.object({ baseUrl: HttpsUrlSchema }).strict();

export const AliyunOssConnectionConfigSchema = z
  .object({
    region: z.string().regex(/^oss-[a-z0-9-]+$/),
    bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  })
  .strict();

export const ProviderConnectionConfigSchema = z.union([
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
    config: ProviderConnectionConfigSchema,
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

export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export type CredentialSource = z.infer<typeof CredentialSourceSchema>;
export type TransportSecurityMode = z.infer<typeof TransportSecurityModeSchema>;
export type AiCapability = z.infer<typeof AiCapabilitySchema>;
export type ProviderConnectionWrite = z.infer<typeof ProviderConnectionWriteSchema>;
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;
export type CapabilityBindingWrite = z.infer<typeof CapabilityBindingWriteSchema>;
export type CapabilityBinding = z.infer<typeof CapabilityBindingSchema>;
export type SettingsOverview = z.infer<typeof SettingsOverviewSchema>;
export type CredentialBundleInput = z.infer<typeof CredentialBundleInputSchema>;
export type LocalCredentialProviderStatus = z.infer<typeof LocalCredentialProviderStatusSchema>;
