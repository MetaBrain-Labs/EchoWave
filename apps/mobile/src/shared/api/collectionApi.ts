/**
 * 案例收集 API 客户端。
 *
 * 通过共享契约解析规则、人工纠正、案例和补收任务。
 *
 * Responsibilities:
 * - 统一客户端信任边界与超时、错误语义。
 *
 * Notes:
 * - 业务记录不写入浏览器存储。
 */
import {
  AnalysisCorrectionInputSchema,
  AnalysisCorrectionListSchema,
  AnalysisCorrectionSchema,
  CaseActionRequestSchema,
  CaseBatchRequestSchema,
  CaseBatchResponseSchema,
  CaseUpdateRequestSchema,
  CollectionCaptureSchema,
  CollectionHistoryRequestSchema,
  CollectionPreviewSchema,
  CollectionRuleInputSchema,
  CollectionRuleListSchema,
  CollectionRuleSchema,
  CollectionRuleUpdateSchema,
  CollectionRunListSchema,
  CollectionRunSchema,
  KnowledgeCaseListSchema,
  KnowledgeCaseSchema,
  ManualCollectionRequestSchema,
  type AnalysisCorrectionInput,
  type CaseContent,
  type CollectionHistoryRequest,
  type CollectionRule,
  type CollectionRuleInput,
  type ManualCollectionRequest,
} from '@echowave/contracts';
import { request } from './request';

/** 读取分组全部规则。 */
export const listCollectionRules = (groupId: string) =>
  request(`/api/groups/${groupId}/collection-rules`, CollectionRuleListSchema);
/** 保存规则时提交完整筛选和乐观版本。 */
export const saveCollectionRule = (
  groupId: string,
  input: CollectionRuleInput,
  previous?: CollectionRule,
) =>
  previous
    ? request(`/api/groups/${groupId}/collection-rules/${previous.id}`, CollectionRuleSchema, {
        method: 'PUT',
        body: CollectionRuleUpdateSchema.parse({ ...input, expectedVersion: previous.version }),
      })
    : request(`/api/groups/${groupId}/collection-rules`, CollectionRuleSchema, {
        method: 'POST',
        body: CollectionRuleInputSchema.parse(input),
      });
/** 读取固定成功分析的来源轮次。 */
export const getCollectionCapture = (jobId: string) =>
  request(`/api/business-analyses/${jobId}/collection`, CollectionCaptureSchema);
/** 查询人工纠正历史。 */
export const listAnalysisCorrections = (jobId: string, tagId: string) =>
  request(
    `/api/business-analyses/${jobId}/tags/${tagId}/corrections`,
    AnalysisCorrectionListSchema,
  );
/** 保存对 AI 判断的人工修正，不覆盖 AI 结果。 */
export const saveAnalysisCorrection = (
  jobId: string,
  tagId: string,
  input: AnalysisCorrectionInput,
) =>
  request(`/api/business-analyses/${jobId}/tags/${tagId}/corrections`, AnalysisCorrectionSchema, {
    method: 'POST',
    body: AnalysisCorrectionInputSchema.parse(input),
  });
/** 手动收集标签、纠正或所选对话片段。 */
export const collectKnowledgeCase = (input: ManualCollectionRequest) =>
  request('/api/knowledge-cases/collect', KnowledgeCaseSchema, {
    method: 'POST',
    body: ManualCollectionRequestSchema.parse(input),
  });
/** 读取知识库候选及正式案例。 */
export const listKnowledgeCases = (knowledgeId: string) =>
  request(`/api/knowledge-bases/${knowledgeId}/cases`, KnowledgeCaseListSchema);
/** 读取案例和媒体发布状态。 */
export const getKnowledgeCase = (id: string) =>
  request(`/api/knowledge-cases/${id}`, KnowledgeCaseSchema);
/** 新增编辑版本，正文播放范围保持来源可信。 */
export const updateKnowledgeCase = (id: string, version: number, content: CaseContent) =>
  request(`/api/knowledge-cases/${id}`, KnowledgeCaseSchema, {
    method: 'PUT',
    body: CaseUpdateRequestSchema.parse({ expectedVersion: version, content }),
  });
/** 执行一个显式审核操作。 */
export const actOnKnowledgeCase = (
  id: string,
  version: number,
  action: 'publish' | 'reject' | 'withdraw' | 'delete' | 'retry',
) =>
  request(`/api/knowledge-cases/${id}/actions`, KnowledgeCaseSchema, {
    method: 'POST',
    body: CaseActionRequestSchema.parse({ expectedVersion: version, action }),
  });
/** 批量操作逐项反馈，允许保留失败选择。 */
export const batchCaseActions = (
  items: {
    id: string;
    expectedVersion: number;
    action: 'publish' | 'reject' | 'withdraw' | 'delete' | 'retry';
  }[],
) =>
  request('/api/knowledge-cases/batch-actions', CaseBatchResponseSchema, {
    method: 'POST',
    body: CaseBatchRequestSchema.parse({ items }),
  });
/** 补收预览不写入任务。 */
export const previewCollectionHistory = (groupId: string, input: CollectionHistoryRequest) =>
  request(`/api/groups/${groupId}/collection-history/preview`, CollectionPreviewSchema, {
    method: 'POST',
    body: CollectionHistoryRequestSchema.parse(input),
  });
/** 用户查看匹配数量后启动持久补收。 */
export const startCollectionHistory = (groupId: string, input: CollectionHistoryRequest) =>
  request(`/api/groups/${groupId}/collection-history`, CollectionRunSchema, {
    method: 'POST',
    body: CollectionHistoryRequestSchema.parse(input),
    timeoutMs: 60000,
  });
/** 查询权威补收进度。 */
export const listCollectionRuns = (groupId: string) =>
  request(`/api/groups/${groupId}/collection-runs`, CollectionRunListSchema);
/** 重试失败来源，已完成来源不重跑。 */
export const retryCollectionRun = (groupId: string, id: string) =>
  request(`/api/groups/${groupId}/collection-runs/${id}/retry`, CollectionRunSchema, {
    method: 'POST',
  });
