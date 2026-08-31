/**
 * 分组持久化端口。
 *
 * 定义分组 Service 所需的事务和查询能力，不暴露其他工作区生命周期。
 *
 * Responsibilities:
 * - 约束分组目录、设置和资源关联持久化。
 * - 为 Service 提供显式返回类型。
 *
 * Notes:
 * - PostgreSQL SQL 实现可在迁移期间由结构类型适配。
 */
import type {
  AudioFileSummary,
  DataSourceSummary,
  GroupCreateRequest,
  GroupResourceLinksUpdateRequest,
  GroupSettings,
  GroupSettingsUpdateRequest,
  GroupSummary,
  KnowledgeBaseGroupLinkRequest,
  KnowledgeBaseSummary,
} from '@echowave/contracts';

/** 分组生命周期 Repository 端口。 */
export interface GroupRepository {
  listGroups(): Promise<{ items: GroupSummary[] }>;
  getGroup(id: string): Promise<GroupSummary>;
  getGroupSettings(id: string): Promise<GroupSettings>;
  updateGroupSettings(id: string, input: GroupSettingsUpdateRequest): Promise<GroupSettings>;
  createGroup(input: GroupCreateRequest): Promise<GroupSummary>;
  archiveGroup(id: string): Promise<void>;
  listGroupAudioFiles(id: string): Promise<{ items: AudioFileSummary[] }>;
  listGroupKnowledgeBases(id: string): Promise<{ items: KnowledgeBaseSummary[] }>;
  replaceGroupKnowledgeBases(
    id: string,
    input: GroupResourceLinksUpdateRequest,
  ): Promise<{ items: KnowledgeBaseSummary[] }>;
  listKnowledgeBaseGroups(id: string): Promise<{ items: GroupSummary[] }>;
  linkKnowledgeBaseGroups(
    id: string,
    input: KnowledgeBaseGroupLinkRequest,
  ): Promise<{ items: GroupSummary[] }>;
  listGroupDataSources(id: string): Promise<{ items: DataSourceSummary[] }>;
  replaceGroupDataSources(
    id: string,
    input: GroupResourceLinksUpdateRequest,
  ): Promise<{ items: DataSourceSummary[] }>;
}
