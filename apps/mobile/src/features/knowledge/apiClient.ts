/**
 * 移动端知识库传输适配器。
 *
 * 封装知识库、文档、文本块和最终问答 JSON 请求，并在客户端信任边界使用共享契约校验响应。
 *
 * Responsibilities:
 * - 统一 API URL、超时、错误解析与运行时校验。
 * - 暴露知识库 feature 使用的窄请求函数。
 *
 * Notes:
 * - 当前问答读取完整 JSON，不解析流式事件。
 */
import type { DocumentPickerAsset } from 'expo-document-picker';
import { Platform } from 'react-native';

import {
  ApiErrorResponseSchema,
  DocumentChunkListResponseSchema,
  DocumentChunkSchema,
  DocumentUploadResponseSchema,
  KnowledgeBaseDetailSchema,
  KnowledgeBaseListResponseSchema,
  KnowledgeDocumentDetailSchema,
  KnowledgeDocumentListResponseSchema,
  RagHistoryResponseSchema,
  RagQueryResponseSchema,
} from '@echowave/contracts';

import { getApiUrl } from '@/shared/api/apiUrl';

/** 知识库请求在移动端暴露的稳定错误类型。 */
export class KnowledgeRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'KnowledgeRequestError';
  }
}

type RuntimeSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

async function request<T>(
  path: string,
  schema: RuntimeSchema<T>,
  init?: RequestInit,
  timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getApiUrl()}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
      signal: controller.signal,
    });
    const body: unknown = response.status === 204 ? undefined : await response.json();
    if (!response.ok) {
      const parsed = ApiErrorResponseSchema.safeParse(body);
      throw new KnowledgeRequestError(
        parsed.success ? parsed.data.error.code : 'NETWORK',
        parsed.success ? parsed.data.error.message : `请求失败（HTTP ${response.status}）。`,
        parsed.success && parsed.data.error.retryable,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new KnowledgeRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。');
    return parsed.data;
  } catch (error) {
    if (error instanceof KnowledgeRequestError) throw error;
    if (controller.signal.aborted)
      throw new KnowledgeRequestError('TIMEOUT', '请求超时，请重试。', true);
    throw new KnowledgeRequestError('NETWORK', '无法连接服务，请检查网络。', true);
  } finally {
    clearTimeout(timeout);
  }
}

export const listKnowledgeBases = () =>
  request('/api/knowledge-bases', KnowledgeBaseListResponseSchema);
export const createKnowledgeBase = (name: string, description: string) =>
  request('/api/knowledge-bases', KnowledgeBaseDetailSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
export const getKnowledgeBase = (id: string) =>
  request(`/api/knowledge-bases/${id}`, KnowledgeBaseDetailSchema);
export const listDocuments = (id: string) =>
  request(`/api/knowledge-bases/${id}/documents`, KnowledgeDocumentListResponseSchema);
export const getDocument = (knowledgeId: string, documentId: string) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/documents/${documentId}`,
    KnowledgeDocumentDetailSchema,
  );
export const listChunks = (knowledgeId: string, documentId: string) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/documents/${documentId}/chunks`,
    DocumentChunkListResponseSchema,
  );
export const getChunk = (knowledgeId: string, documentId: string, chunkId: string) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/documents/${documentId}/chunks/${chunkId}`,
    DocumentChunkSchema,
  );

export async function uploadDocument(knowledgeId: string, asset: DocumentPickerAsset) {
  const form = new FormData();
  if (Platform.OS === 'web' && asset.file) {
    form.append('file', asset.file);
  } else {
    form.append('file', {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? 'application/octet-stream',
    } as unknown as Blob);
  }
  return request(
    `/api/knowledge-bases/${knowledgeId}/documents`,
    DocumentUploadResponseSchema,
    { method: 'POST', body: form },
    30_000,
  );
}

export const retryDocument = (knowledgeId: string, documentId: string) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/documents/${documentId}/retry`,
    KnowledgeDocumentDetailSchema,
    { method: 'POST' },
  );

/** 提交问题并读取完整、已通过服务器引用校验的最终回答 JSON。 */
export const queryKnowledge = (knowledgeId: string, question: string, conversationId?: string) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/query`,
    RagQueryResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, ...(conversationId ? { conversationId } : {}) }),
    },
    50_000,
  );

/** 读取当前知识库最近六个已完成问答。 */
export const listQueryHistory = (knowledgeId: string) =>
  request(`/api/knowledge-bases/${knowledgeId}/query-history`, RagHistoryResponseSchema);
