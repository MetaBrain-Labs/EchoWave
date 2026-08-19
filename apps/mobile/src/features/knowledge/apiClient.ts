/** Runtime-validates all mobile knowledge-library requests against shared contracts. */
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
  RagQueryResponseSchema,
} from '@echowave/contracts';

import { apiUrl } from '../service/apiClient';

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

async function request<T>(path: string, schema: RuntimeSchema<T>, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiUrl}${path}`, {
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
    if (!parsed.success) throw new KnowledgeRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。');
    return parsed.data;
  } catch (error) {
    if (error instanceof KnowledgeRequestError) throw error;
    if (controller.signal.aborted) throw new KnowledgeRequestError('TIMEOUT', '请求超时，请重试。', true);
    throw new KnowledgeRequestError('NETWORK', '无法连接服务，请检查网络。', true);
  } finally {
    clearTimeout(timeout);
  }
}

export const listKnowledgeBases = () => request('/api/knowledge-bases', KnowledgeBaseListResponseSchema);
export const createKnowledgeBase = (name: string, description: string) =>
  request('/api/knowledge-bases', KnowledgeBaseDetailSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
export const getKnowledgeBase = (id: string) => request(`/api/knowledge-bases/${id}`, KnowledgeBaseDetailSchema);
export const listDocuments = (id: string) => request(`/api/knowledge-bases/${id}/documents`, KnowledgeDocumentListResponseSchema);
export const getDocument = (knowledgeId: string, documentId: string) =>
  request(`/api/knowledge-bases/${knowledgeId}/documents/${documentId}`, KnowledgeDocumentDetailSchema);
export const listChunks = (knowledgeId: string, documentId: string) =>
  request(`/api/knowledge-bases/${knowledgeId}/documents/${documentId}/chunks`, DocumentChunkListResponseSchema);
export const getChunk = (knowledgeId: string, documentId: string, chunkId: string) =>
  request(`/api/knowledge-bases/${knowledgeId}/documents/${documentId}/chunks/${chunkId}`, DocumentChunkSchema);

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

export const queryKnowledge = (knowledgeId: string, question: string, conversationId?: string) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/query`,
    RagQueryResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, ...(conversationId ? { conversationId } : {}) }),
    },
    25_000,
  );
