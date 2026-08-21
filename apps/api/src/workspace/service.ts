/**
 * 音频工作区应用服务。
 *
 * 向 HTTP 层暴露分组生命周期，以及数据源、音频与分析详情查询用例。
 *
 * Responsibilities:
 * - 保持传输层与 PostgreSQL 查询实现解耦。
 *
 * Notes:
 * - 真实上传、同步和音频处理不属于当前服务边界。
 */
import type { GroupCreateRequest } from '@echowave/contracts';

import type { WorkspaceRepository } from './persistence/workspaceRepository.ts';

/** HTTP 传输层依赖的音频工作区接口。 */
export interface WorkspaceService {
  listGroups(): ReturnType<WorkspaceRepository['listGroups']>;
  getGroup(id: string): ReturnType<WorkspaceRepository['getGroup']>;
  createGroup(input: GroupCreateRequest): ReturnType<WorkspaceRepository['createGroup']>;
  archiveGroup(id: string): ReturnType<WorkspaceRepository['archiveGroup']>;
  listGroupAudioFiles(id: string): ReturnType<WorkspaceRepository['listGroupAudioFiles']>;
  listGroupKnowledgeBases(id: string): ReturnType<WorkspaceRepository['listGroupKnowledgeBases']>;
  listGroupDataSources(id: string): ReturnType<WorkspaceRepository['listGroupDataSources']>;
  listDataSources(): ReturnType<WorkspaceRepository['listDataSources']>;
  getDataSource(id: string): ReturnType<WorkspaceRepository['getDataSource']>;
  listDataSourceAudioFiles(id: string): ReturnType<WorkspaceRepository['listDataSourceAudioFiles']>;
  listDataSourceIngestionRecords(id: string): ReturnType<WorkspaceRepository['listDataSourceIngestionRecords']>;
  listDataSourceGroups(id: string): ReturnType<WorkspaceRepository['listDataSourceGroups']>;
  getAudioAnalysis(id: string): ReturnType<WorkspaceRepository['getAudioAnalysis']>;
}

/** 直接组合窄仓储分组生命周期与读取能力的默认工作区服务。 */
export class DefaultWorkspaceService implements WorkspaceService {
  constructor(private readonly repository: WorkspaceRepository) {}

  listGroups() { return this.repository.listGroups(); }
  getGroup(id: string) { return this.repository.getGroup(id); }
  createGroup(input: GroupCreateRequest) { return this.repository.createGroup(input); }
  archiveGroup(id: string) { return this.repository.archiveGroup(id); }
  listGroupAudioFiles(id: string) { return this.repository.listGroupAudioFiles(id); }
  listGroupKnowledgeBases(id: string) { return this.repository.listGroupKnowledgeBases(id); }
  listGroupDataSources(id: string) { return this.repository.listGroupDataSources(id); }
  listDataSources() { return this.repository.listDataSources(); }
  getDataSource(id: string) { return this.repository.getDataSource(id); }
  listDataSourceAudioFiles(id: string) { return this.repository.listDataSourceAudioFiles(id); }
  listDataSourceIngestionRecords(id: string) { return this.repository.listDataSourceIngestionRecords(id); }
  listDataSourceGroups(id: string) { return this.repository.listDataSourceGroups(id); }
  getAudioAnalysis(id: string) { return this.repository.getAudioAnalysis(id); }
}
