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
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import {
  ApiErrorResponseSchema,
  CitationSourceResponseSchema,
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

import { request as workspaceRequest } from '@/shared/api/request';
import { getApiUrl } from '@/shared/api/apiUrl';
import { resolveUploadFile } from '@/shared/api/uploadFile';
import { localizeRequestError } from '@/shared/i18n/errorLocalization';

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
        localizeRequestError(
          parsed.success ? parsed.data.error.code : 'HTTP_ERROR',
          parsed.success ? parsed.data.error.message : `请求失败（HTTP ${response.status}）。`,
        ),
        parsed.success && parsed.data.error.retryable,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new KnowledgeRequestError(
        'INVALID_RESPONSE',
        localizeRequestError('INVALID_RESPONSE', '服务返回了无法识别的数据。'),
      );
    return parsed.data;
  } catch (error) {
    if (error instanceof KnowledgeRequestError) throw error;
    if (controller.signal.aborted)
      throw new KnowledgeRequestError(
        'TIMEOUT',
        localizeRequestError('TIMEOUT', '请求超时，请重试。'),
        true,
      );
    if (__DEV__) console.error('[knowledge-api] request failed', { path, error });
    throw new KnowledgeRequestError(
      'NETWORK',
      localizeRequestError('NETWORK', '无法连接服务，请检查网络。'),
      true,
    );
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

/** 下载原始文档；Web 触发浏览器下载，原生端写入文档目录后交给系统分享面板。 */
export async function downloadDocumentSource(
  knowledgeId: string,
  documentId: string,
  fallbackName: string,
): Promise<void> {
  const response = await fetch(
    `${getApiUrl()}/api/knowledge-bases/${knowledgeId}/documents/${documentId}/source`,
    { headers: { Accept: 'application/octet-stream' } },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const parsed = ApiErrorResponseSchema.safeParse(body);
    throw new KnowledgeRequestError(
      parsed.success ? parsed.data.error.code : 'HTTP_ERROR',
      localizeRequestError(
        parsed.success ? parsed.data.error.code : 'HTTP_ERROR',
        parsed.success ? parsed.data.error.message : `请求失败（HTTP ${response.status}）。`,
      ),
      parsed.success && parsed.data.error.retryable,
    );
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : fallbackName;
  const body = await response.arrayBuffer();
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([body]));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.document, filename);
  file.write(new Uint8Array(body));
  if (!(await Sharing.isAvailableAsync())) {
    throw new KnowledgeRequestError(
      'SHARING_UNAVAILABLE',
      localizeRequestError('SHARING_UNAVAILABLE', '当前设备不支持保存或分享文件。'),
    );
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: response.headers.get('content-type') ?? undefined,
  });
}
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

export async function uploadDocument(
  knowledgeId: string,
  asset: DocumentPickerAsset,
  replacement?: { documentId: string; expectedVersion: number; title?: string },
) {
  const form = new FormData();
  if (replacement) {
    form.append('expectedVersion', String(replacement.expectedVersion));
    if (replacement.title) form.append('title', replacement.title);
  }
  if (Platform.OS === 'web' && asset.file) {
    form.append('file', asset.file);
  } else {
    const file = resolveUploadFile(asset);
    if (!file) {
      throw new KnowledgeRequestError(
        'FILE_UNAVAILABLE',
        localizeRequestError('FILE_UNAVAILABLE', '无法读取所选择的文件，请重新选择。'),
      );
    }
    form.append('file', file);
  }
  return request(
    replacement
      ? `/api/knowledge-bases/${knowledgeId}/documents/${replacement.documentId}/revisions`
      : `/api/knowledge-bases/${knowledgeId}/documents`,
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

/** 更新知识库已有元信息，不重建向量。 */
export const updateKnowledgeBase = (knowledgeId: string, name: string, description: string) =>
  request(`/api/knowledge-bases/${knowledgeId}`, KnowledgeBaseDetailSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
/** 文件名参与 embedding，改名返回新版本处理任务。 */
export const renameDocument = (
  knowledgeId: string,
  documentId: string,
  title: string,
  expectedVersion: number,
) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/documents/${documentId}`,
    DocumentUploadResponseSchema,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, expectedVersion }),
    },
  );
/** 删除成功后原文立即退出检索，清理由服务器任务执行。 */
export const deleteDocument = (knowledgeId: string, documentId: string) =>
  workspaceRequest(`/api/knowledge-bases/${knowledgeId}/documents/${documentId}`, null, {
    method: 'DELETE',
  });
/** 引用打开时重新读取来源状态，防止已打开页面使用过期状态。 */
export const getCitationSource = (knowledgeId: string, documentId: string, revisionId: string) =>
  workspaceRequest(
    `/api/knowledge-bases/${knowledgeId}/documents/${documentId}/revisions/${revisionId}/source-status`,
    CitationSourceResponseSchema,
  );
