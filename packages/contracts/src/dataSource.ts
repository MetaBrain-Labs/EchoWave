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

export type DataSourceSummary = z.infer<typeof DataSourceSummarySchema>;
export type DataSourceDetail = z.infer<typeof DataSourceDetailSchema>;
export type DataSourceIngestionRecord = z.infer<typeof DataSourceIngestionRecordSchema>;
export type LinkedDataSourceGroup = z.infer<typeof LinkedDataSourceGroupSchema>;
