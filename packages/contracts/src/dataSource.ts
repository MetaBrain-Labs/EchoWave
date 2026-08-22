/**
 * 数据源网络契约。
 *
 * 定义数据源目录、详情设置、上传时间线和关联分组聚合结果。
 *
 * Responsibilities:
 * - 校验数据源业务配置与只读统计。
 * - 表达上传或转写失败所需的结构化信息。
 *
 * Notes:
 * - 契约禁止承载第三方连接凭据。
 */
import { z } from 'zod';

import { AudioFileSummarySchema } from './audio.ts';
import { EntityIdSchema } from './common.ts';

export const DataSourceTypeSchema = z.enum([
  'manual_upload',
  'http_api',
  'cloud_drive',
  's3',
  'local_folder',
]);
export const DataSourceLocationSchema = z.enum(['local', 'cloud']);
export const DataSourceConnectionStatusSchema = z.enum([
  'connected',
  'disconnected',
  'error',
  'disabled',
]);

const DataSourceNameSchema = z.string().trim().min(1).max(120);
const DataSourceDescriptionSchema = z.string().trim().max(1_000);

/** 创建本地手动上传数据源时允许客户端提交的字段。 */
export const DataSourceCreateRequestSchema = z.object({
  name: DataSourceNameSchema,
  description: DataSourceDescriptionSchema.default(''),
});

/** 编辑数据源时允许修改的展示字段。 */
export const DataSourceUpdateRequestSchema = z
  .object({
    name: DataSourceNameSchema.optional(),
    description: DataSourceDescriptionSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: '至少提供一个需要更新的字段。',
  });

/** 批量关联活动分组的请求。 */
export const DataSourceGroupLinkRequestSchema = z.object({
  groupIds: z
    .array(EntityIdSchema)
    .min(1)
    .max(100)
    .refine((items) => new Set(items).size === items.length, { message: '分组 ID 不能重复。' }),
});

/** 数据源列表使用的摘要。 */
export const DataSourceSummarySchema = z.object({
  id: EntityIdSchema,
  name: z.string(),
  description: z.string(),
  sourceType: DataSourceTypeSchema,
  location: DataSourceLocationSchema,
  connectionLabel: z.string(),
  connectionStatus: DataSourceConnectionStatusSchema,
  linkedGroupCount: z.number().int().nonnegative(),
  lastUploadedAt: z.string().datetime().nullable(),
});

export const DataSourceMetricsSchema = z.object({
  audioCount: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  transcribedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
});

/** 数据源详情中稳定的音频处理设置。 */
export const DataSourceAnalysisSettingsSchema = z.object({
  transcriptionModel: z.string(),
  autoTranscribe: z.boolean(),
  emotionAnalysis: z.boolean(),
  speakerDiarization: z.boolean(),
  sceneSegmentation: z.boolean(),
  skipInvalidAudio: z.boolean(),
});

export const DataSourceDetailSchema = DataSourceSummarySchema.extend({
  metrics: DataSourceMetricsSchema,
  settings: DataSourceAnalysisSettingsSchema,
});
export const DataSourceListResponseSchema = z.object({ items: z.array(DataSourceSummarySchema) });

/** 数据源上传时间线中的一条聚合记录。 */
export const DataSourceIngestionRecordSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(['upload-success', 'upload-failed', 'transcription-failed']),
  occurredAt: z.string().datetime(),
  audioCount: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  retryable: z.boolean(),
});
export const DataSourceIngestionListResponseSchema = z.object({
  items: z.array(DataSourceIngestionRecordSchema),
});

/** 数据源关联分组及其动态统计。 */
export const LinkedDataSourceGroupSchema = z.object({
  id: EntityIdSchema,
  name: z.string(),
  analysisCount: z.number().int().nonnegative(),
  audioCount: z.number().int().nonnegative(),
  knowledgeCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
});
export const LinkedDataSourceGroupListResponseSchema = z.object({
  items: z.array(LinkedDataSourceGroupSchema),
});

/** 一批音频可靠保存后的权威响应。 */
export const DataSourceAudioUploadResponseSchema = z.object({
  ingestionRunId: EntityIdSchema,
  items: z.array(AudioFileSummarySchema),
});

export type DataSourceCreateRequest = z.infer<typeof DataSourceCreateRequestSchema>;
export type DataSourceUpdateRequest = z.infer<typeof DataSourceUpdateRequestSchema>;
export type DataSourceGroupLinkRequest = z.infer<typeof DataSourceGroupLinkRequestSchema>;
export type DataSourceAudioUploadResponse = z.infer<typeof DataSourceAudioUploadResponseSchema>;
export type DataSourceSummary = z.infer<typeof DataSourceSummarySchema>;
export type DataSourceDetail = z.infer<typeof DataSourceDetailSchema>;
export type DataSourceIngestionRecord = z.infer<typeof DataSourceIngestionRecordSchema>;
export type LinkedDataSourceGroup = z.infer<typeof LinkedDataSourceGroupSchema>;
