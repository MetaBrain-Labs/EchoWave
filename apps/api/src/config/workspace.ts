/**
 * 知识与音频工作区配置。
 *
 * 管理领域模型、租户、LangGraph schema 和文件目录配置，并组合供应商连接配置。
 *
 * Responsibilities:
 * - 校验固定模型与目录契约。
 * - 生成历史兼容的 rag 运行时配置结构。
 *
 * Notes:
 * - 不读取配置文件，供应商跨字段校验由 providers 模块负责。
 */
import { AudioTranscriptionModelSchema, type AudioTranscriptionModel } from '@echowave/contracts';
import { z } from 'zod';

import type { ProviderConfig } from './providers.ts';
import { OptionalStringSchema } from './schema.ts';

export const WorkspaceEnvironmentSchema = z.object({
  DEV_TENANT_ID: z.string().uuid(),
  RAG_EMBEDDING_MODEL: z.literal('qwen3.7-text-embedding'),
  RAG_EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .refine((value) => value === 1024),
  LANGGRAPH_SCHEMA: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  UPLOAD_TEMP_DIR: z.string().min(1),
  AUDIO_STORAGE_DIR: z.string().min(1),
  AUDIO_TRANSCRIPTION_MODEL: AudioTranscriptionModelSchema,
  AUDIO_EMOTION_MODEL: z.literal('qwen3.5-omni-flash'),
  AUDIO_TRANSCRIPTION_TEMP_DIR: z.string().min(1),
  AUDIO_TRANSCRIPTION_MAX_IN_FLIGHT: z.coerce.number().int().min(1).max(100),
  FFMPEG_PATH: OptionalStringSchema,
});

export type RagConfig = {
  tenantId: string;
  dashScope: ProviderConfig['dashScope'];
  embeddingModel: 'qwen3.7-text-embedding';
  embeddingDimensions: 1024;
  deepSeekApiKey: string;
  deepSeekBaseUrl: string;
  deepSeekChatModel: 'deepseek-v4-flash';
  enableThinking: boolean;
  langGraphSchema: string;
  uploadTempDir: string;
  audioStorageDir: string;
  audioTranscriptionModel: AudioTranscriptionModel;
  audioEmotionModel: 'qwen3.5-omni-flash';
  audioTranscriptionTempDir: string;
  audioTranscriptionMaxInFlight: number;
  ffmpegPath?: string;
};

/** 组合工作区字段与供应商配置，保持既有 ApiConfig.rag 结构。 */
export function createRagConfig(
  values: z.infer<typeof WorkspaceEnvironmentSchema>,
  providers: ProviderConfig,
): RagConfig {
  return {
    tenantId: values.DEV_TENANT_ID,
    dashScope: providers.dashScope,
    embeddingModel: values.RAG_EMBEDDING_MODEL,
    embeddingDimensions: values.RAG_EMBEDDING_DIMENSIONS,
    deepSeekApiKey: providers.deepSeek.apiKey,
    deepSeekBaseUrl: providers.deepSeek.baseUrl,
    deepSeekChatModel: providers.deepSeek.chatModel,
    enableThinking: providers.deepSeek.enableThinking,
    langGraphSchema: values.LANGGRAPH_SCHEMA,
    uploadTempDir: values.UPLOAD_TEMP_DIR,
    audioStorageDir: values.AUDIO_STORAGE_DIR,
    audioTranscriptionModel: values.AUDIO_TRANSCRIPTION_MODEL,
    audioEmotionModel: values.AUDIO_EMOTION_MODEL,
    audioTranscriptionTempDir: values.AUDIO_TRANSCRIPTION_TEMP_DIR,
    audioTranscriptionMaxInFlight: values.AUDIO_TRANSCRIPTION_MAX_IN_FLIGHT,
    ...(values.FFMPEG_PATH ? { ffmpegPath: values.FFMPEG_PATH } : {}),
  };
}
