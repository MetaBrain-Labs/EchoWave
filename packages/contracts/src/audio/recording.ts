/**
 * 本机录音草稿持久化契约。
 *
 * 约束原件相对定位和跨请求恢复引用，不包含分析结果或服务端资源缓存。
 *
 * Responsibilities:
 * - 校验本机版本化录音元数据与任务请求快照。
 *
 * Notes:
 * - 不作为音频上传 wire shape，录音原件仍由手机保存。
 */
import { z } from 'zod';
import { AudioAnalysisBatchCreateRequestSchema } from './automation.ts';
import { AudioUploadSessionResponseSchema } from './runtime.ts';

/** 本机草稿只记录上传引用，不拥有服务端业务状态。 */
export const RecordingDraftSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  path: z
    .string()
    .regex(/^[a-zA-Z0-9_./-]+$/)
    .refine((p) => !p.includes('..') && !p.startsWith('/')),
  durationMs: z.number().nonnegative(),
  sizeBytes: z.number().nonnegative(),
  serverUrl: z.string(),
  dataSourceId: z.string(),
  interrupted: z.boolean(),
  state: z.enum(['recording', 'local', 'uploading', 'uploaded', 'submitting', 'submitted']),
  session: AudioUploadSessionResponseSchema.optional(),
  audioFileId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  operationKey: z.string().optional(),
  batchRequest: AudioAnalysisBatchCreateRequestSchema.optional(),
});
/** 本机元数据的解析后类型，不代表服务端资产。 */
export type RecordingDraft = z.infer<typeof RecordingDraftSchema>;
