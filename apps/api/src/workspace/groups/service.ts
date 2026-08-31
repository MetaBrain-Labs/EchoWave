/**
 * 分组领域服务端口。
 *
 * 定义 HTTP 传输层可使用的分组生命周期与资源关联能力。
 *
 * Responsibilities:
 * - 暴露显式稳定的分组用例返回类型。
 * - 隔离传输层与 PostgreSQL Repository 实现。
 *
 * Notes:
 * - 跨资源关联仍由分组领域拥有事务语义。
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

import type { GroupRepository } from './repository.ts';

/** 分组路由依赖的应用服务端口。 */
export interface GroupService {
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

/** 直接依赖分组查询能力的默认服务实现。 */
export class DefaultGroupService implements GroupService {
  constructor(private readonly repository: GroupRepository) {}

  listGroups() {
    return this.repository.listGroups();
  }
  getGroup(id: string) {
    return this.repository.getGroup(id);
  }
  getGroupSettings(id: string) {
    return this.repository.getGroupSettings(id);
  }
  updateGroupSettings(id: string, input: GroupSettingsUpdateRequest) {
    return this.repository.updateGroupSettings(id, input);
  }
  createGroup(input: GroupCreateRequest) {
    return this.repository.createGroup(input);
  }
  archiveGroup(id: string) {
    return this.repository.archiveGroup(id);
  }
  listGroupAudioFiles(id: string) {
    return this.repository.listGroupAudioFiles(id);
  }
  listGroupKnowledgeBases(id: string) {
    return this.repository.listGroupKnowledgeBases(id);
  }
  replaceGroupKnowledgeBases(id: string, input: GroupResourceLinksUpdateRequest) {
    return this.repository.replaceGroupKnowledgeBases(id, input);
  }
  listKnowledgeBaseGroups(id: string) {
    return this.repository.listKnowledgeBaseGroups(id);
  }
  linkKnowledgeBaseGroups(id: string, input: KnowledgeBaseGroupLinkRequest) {
    return this.repository.linkKnowledgeBaseGroups(id, input);
  }
  listGroupDataSources(id: string) {
    return this.repository.listGroupDataSources(id);
  }
  replaceGroupDataSources(id: string, input: GroupResourceLinksUpdateRequest) {
    return this.repository.replaceGroupDataSources(id, input);
  }
}
