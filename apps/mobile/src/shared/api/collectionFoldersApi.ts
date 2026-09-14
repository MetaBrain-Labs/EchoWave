/**
 * 收集文件夹目录客户端。
 *
 * Responsibilities:
 * - 使用共享契约校验目录、子项与历史归类。
 * Notes:
 * - 目录组织不替代原文档状态接口。
 */
import {
  CollectionFolderContentsSchema,
  KnowledgeDirectorySchema,
  OrganizeCollectionCasesSchema,
  CaseBatchResponseSchema,
  type OrganizeCollectionCases,
} from '@echowave/contracts';
import { request } from './request';
/** 查询名称及内部文档匹配的目录条目。 */
export const listKnowledgeDirectory = (knowledgeId: string, query = '') =>
  request(
    `/api/knowledge-bases/${knowledgeId}/directory?query=${encodeURIComponent(query)}`,
    KnowledgeDirectorySchema,
  );
/** 保留根目录搜索条件进入规则文件夹。 */
export const getCollectionFolder = (knowledgeId: string, folderId: string, query = '') =>
  request(
    `/api/knowledge-bases/${knowledgeId}/collection-folders/${folderId}?query=${encodeURIComponent(query)}`,
    CollectionFolderContentsSchema,
  );
/** 批量归类逐项返回失败，不改变正文和文档身份。 */
export const organizeCollectionCases = (
  knowledgeId: string,
  folderId: string,
  input: OrganizeCollectionCases,
) =>
  request(
    `/api/knowledge-bases/${knowledgeId}/collection-folders/${folderId}/organize`,
    CaseBatchResponseSchema,
    { method: 'POST', body: OrganizeCollectionCasesSchema.parse(input) },
  );
