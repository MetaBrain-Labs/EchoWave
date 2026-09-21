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
  KnowledgeCategoryListSchema,
  KnowledgeCategorySchema,
  DocumentClassificationSchema,
  type KnowledgeCategory,
  type KnowledgeCategoryCreate,
  type KnowledgeCategoryUpdate,
  type DocumentClassificationUpdate,
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

/** 类别目录不是文件夹目录，停用项仍保留历史归属。 */
export const listKnowledgeCategories = () =>
  request('/api/knowledge-categories', KnowledgeCategoryListSchema);
/** 只列出当前知识库实际可检索类别。 */
export const listRetrievalCategories = (knowledgeId: string) =>
  request(`/api/knowledge-bases/${knowledgeId}/categories`, KnowledgeCategoryListSchema);
/** 创建包含用途说明的自定义类别。 */
export const createKnowledgeCategory = (input: KnowledgeCategoryCreate) =>
  request('/api/knowledge-categories', KnowledgeCategorySchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
/** 类别改名、用途维护及停用必须检查版本。 */
export const updateKnowledgeCategory = (id: string, input: KnowledgeCategoryUpdate) =>
  request(`/api/knowledge-categories/${id}`, KnowledgeCategorySchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
/** 获取活动 revision 的人工分类和非生效建议。 */
export const getDocumentClassification = (knowledgeId: string, documentId: string) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/documents/${documentId}/classification`,
    DocumentClassificationSchema,
  );
/** 确认分类或恢复继承，不触发 embedding。 */
export const updateDocumentClassification = (
  knowledgeId: string,
  documentId: string,
  input: DocumentClassificationUpdate,
) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/documents/${documentId}/classification`,
    DocumentClassificationSchema,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
/** 已有文档的分类建议只在用户请求时生成。 */
export const suggestDocumentClassification = (knowledgeId: string, documentId: string) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/documents/${documentId}/classification/suggest`,
    DocumentClassificationSchema,
    { method: 'POST' },
    40000,
  );
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

/** 使用服务器持久原文件和当前 parser 重建一个新的文档 revision。 */
export const reindexDocument = (knowledgeId: string, documentId: string, expectedVersion: number) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/documents/${documentId}/reindex`,
    DocumentUploadResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion }),
    },
  );

/** 提交问题并读取完整、已通过服务器引用校验的最终回答 JSON。 */
export const queryKnowledge = (
  knowledgeId: string,
  question: string,
  conversationId?: string,
  categoryIds?: string[],
  /** 跨知识库检索范围；只有一个库或未提供时保持单库检索。 */
  knowledgeBaseIds?: string[],
) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/query`,
    RagQueryResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        ...(conversationId ? { conversationId } : {}),
        ...(categoryIds?.length ? { categoryIds } : {}),
        ...(knowledgeBaseIds && knowledgeBaseIds.length > 1 ? { knowledgeBaseIds } : {}),
      }),
    },
    50_000,
  );

/**
 * 按知识库逐个读取可检索类别，并标注类别归属，供跨库检索面板分组展示。
 *
 * 单个知识库目录失败不阻塞其余库：返回失败计数，由调用方提示并允许刷新重试。
 */
export const listRetrievalCategoriesByBase = async (
  knowledgeBases: { id: string; name: string }[],
): Promise<{ categories: (KnowledgeCategory & { knowledgeBaseId: string })[]; failed: number }> => {
  const results = await Promise.all(
    knowledgeBases.map(async (item) => {
      try {
        const response = await listRetrievalCategories(item.id);
        return {
          failed: 0,
          categories: response.items.map((category) => ({
            ...category,
            knowledgeBaseId: item.id,
          })),
        };
      } catch {
        return { failed: 1, categories: [] };
      }
    }),
  );
  return {
    categories: results.flatMap((result) => result.categories),
    failed: results.reduce((total, result) => total + result.failed, 0),
  };
};

/** 读取当前知识库最近六个已完成问答。 */
export const listQueryHistory = (knowledgeId: string) =>
  request(`/api/knowledge-bases/${knowledgeId}/query-history`, RagHistoryResponseSchema);

/** 更新知识库已有元信息，不重建向量。 */
export const updateKnowledgeBase = (
  knowledgeId: string,
  name: string,
  description: string,
  classification?: { defaultCategoryId: string; expectedCategoryVersion: number },
) =>
  request(`/api/knowledge-bases/${knowledgeId}`, KnowledgeBaseDetailSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, ...classification }),
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
