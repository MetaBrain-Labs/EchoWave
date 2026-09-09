/**
 * 音频运行模式与存储生命周期网络契约。
 *
 * 定义租户级运行模式、上传会话、源文件状态以及 ASR 版本选择的稳定 wire shape。
 *
 * Responsibilities:
 * - 约束模式管理、存储保留策略和可恢复上传协议。
 * - 表达同一音频的多个 ASR Run 及其当前选择策略。
 *
 * Notes:
 * - 响应仅包含非敏感存储摘要，不暴露对象键或 Credential。
 */
import { z } from 'zod';

import { EntityIdSchema, SupportedLanguageSchema } from '../common.ts';

export const AudioRuntimeModeSchema = z.enum(['hybrid', 'object_storage', 'lightweight_local']);
export const AudioSourceStateSchema = z.enum(['available', 'cleaned', 'missing']);
export const AudioSourceRecoveryStateSchema = z.enum(['not_required', 'required', 'verifying']);
export const AudioTranscriptSelectionModeSchema = z.enum(['auto', 'manual']);

export const AudioRuntimeRetentionSchema = z
  .object({
    originalRetentionDays: z.number().int().min(1).max(3650).nullable(),
    intermediateRetentionHours: z.number().int().min(1).max(168),
  })
  .strict();

export const AudioRuntimeModeAvailabilitySchema = z
  .object({
    mode: AudioRuntimeModeSchema,
    available: z.boolean(),
    unavailableReason: z.string().nullable(),
  })
  .strict();

export const AudioRuntimeOverviewSchema = z
  .object({
    mode: AudioRuntimeModeSchema,
    revision: z.number().int().positive(),
    retention: AudioRuntimeRetentionSchema,
    modes: z.array(AudioRuntimeModeAvailabilitySchema).length(3),
  })
  .strict();

export const AudioRuntimeUpdateRequestSchema = z
  .object({
    mode: AudioRuntimeModeSchema,
    retention: AudioRuntimeRetentionSchema,
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export const AudioUploadSessionCreateRequestSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(160),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(200 * 1024 * 1024),
    includeAcousticEmotion: z.boolean().default(true),
  })
  .strict();

export const AudioUploadTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('api_binary'),
      url: z.string().min(1),
      headers: z.record(z.string(), z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal('presigned_put'),
      url: z.string().url(),
      headers: z.record(z.string(), z.string()),
      expiresAt: z.string().datetime(),
    })
    .strict(),
]);

export const AudioUploadSessionResponseSchema = z
  .object({
    id: EntityIdSchema,
    audioFileId: EntityIdSchema,
    mode: AudioRuntimeModeSchema,
    upload: AudioUploadTargetSchema,
    expiresAt: z.string().datetime(),
  })
  .strict();

export const AudioUploadSessionCompleteResponseSchema = z
  .object({
    audioFileId: EntityIdSchema,
    status: z.enum(['validating', 'ready']),
  })
  .strict();

export const AudioSourceRemountResponseSchema = z
  .object({
    audioFileId: EntityIdSchema,
    sourceState: z.literal('available'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const AudioTranscriptionRunSummarySchema = z
  .object({
    id: EntityIdSchema,
    revision: z.number().int().positive(),
    status: z.enum(['queued', 'transcribing', 'analyzing', 'ready', 'failed']),
    model: z.string().min(1),
    preprocessing: z.enum(['silero_vad', 'whole_file']),
    includeAcousticEmotion: z.boolean(),
    language: SupportedLanguageSchema.default('zh-CN'),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();

export const AudioTranscriptionRunListResponseSchema = z
  .object({
    selectionMode: AudioTranscriptSelectionModeSchema,
    activeRevisionId: EntityIdSchema.nullable(),
    items: z.array(AudioTranscriptionRunSummarySchema),
  })
  .strict();

export const AudioTranscriptSelectionRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }).strict(),
  z.object({ mode: z.literal('manual'), revisionId: EntityIdSchema }).strict(),
]);

export type AudioRuntimeMode = z.infer<typeof AudioRuntimeModeSchema>;
export type AudioSourceState = z.infer<typeof AudioSourceStateSchema>;
export type AudioSourceRecoveryState = z.infer<typeof AudioSourceRecoveryStateSchema>;
export type AudioRuntimeOverview = z.infer<typeof AudioRuntimeOverviewSchema>;
export type AudioRuntimeUpdateRequest = z.infer<typeof AudioRuntimeUpdateRequestSchema>;
export type AudioUploadSessionCreateRequest = z.infer<typeof AudioUploadSessionCreateRequestSchema>;
export type AudioUploadSessionResponse = z.infer<typeof AudioUploadSessionResponseSchema>;
export type AudioTranscriptionRunListResponse = z.infer<
  typeof AudioTranscriptionRunListResponseSchema
>;
export type AudioTranscriptSelectionRequest = z.infer<typeof AudioTranscriptSelectionRequestSchema>;
