/**
 * 工作区目录 runtime 工厂。
 *
 * 装配 groups、data-sources 与 audio core 的窄 Repository 和应用服务。
 *
 * Responsibilities:
 * - 创建工作区目录领域的 PostgreSQL 适配器。
 * - 返回分组、数据源服务和音频核心读取端口。
 *
 * Notes:
 * - 转写与分析 Worker 由 audio runtime 独立装配。
 */
import type { ApiConfig } from '../../config/env.ts';
import type { DatabasePool } from '../../infrastructure/postgres.ts';
import { PostgresAudioCoreRepository } from '../../workspace/audio/core/postgresAudioCoreRepository.ts';
import { PostgresDataSourceRepository } from '../../workspace/data-sources/postgresDataSourceRepository.ts';
import { DefaultDataSourceService } from '../../workspace/data-sources/service.ts';
import { PostgresGroupRepository } from '../../workspace/groups/postgresGroupRepository.ts';
import { DefaultGroupService } from '../../workspace/groups/service.ts';

type WorkspaceRuntimeOptions = {
  config: ApiConfig;
  pool: DatabasePool;
};

/** 创建工作区目录服务与音频核心读取 Repository。 */
export function createWorkspaceRuntime({ config, pool }: WorkspaceRuntimeOptions) {
  const groupRepository = new PostgresGroupRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const dataSourceRepository = new PostgresDataSourceRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
    groupRepository,
  );
  const audioCoreRepository = new PostgresAudioCoreRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  return {
    groupService: new DefaultGroupService(groupRepository),
    dataSourceService: new DefaultDataSourceService(
      dataSourceRepository,
      config.rag.audioStorageDir,
    ),
    audioCoreRepository,
  };
}
