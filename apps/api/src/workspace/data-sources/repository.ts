/**
 * 数据源持久化端口。
 *
 * 定义数据源 Service 使用的目录、关联和音频发布能力。
 *
 * Responsibilities:
 * - 约束数据源生命周期 Repository 方法。
 * - 描述文件可靠写入后待发布的音频元数据。
 *
 * Notes:
 * - 文件写入由 Service 负责，数据库事务由实现负责。
 */
import type {
  AudioFileSummary,
  DataSourceAudioUploadResponse,
  DataSourceCreateRequest,
  DataSourceDetail,
  DataSourceGroupLinkRequest,
  DataSourceIngestionRecord,
  DataSourceSummary,
  DataSourceUpdateRequest,
  LinkedDataSourceGroup,
} from '@echowave/contracts';

/** 文件系统已可靠写入、等待数据库事务发布的音频元数据。 */
export type StoredAudioUpload = {
  title: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  storageKey: string;
};

/** 数据源生命周期 Repository 端口。 */
export interface DataSourceRepository {
  listDataSources(): Promise<{ items: DataSourceSummary[] }>;
  createDataSource(input: DataSourceCreateRequest): Promise<DataSourceDetail>;
  getDataSource(id: string): Promise<DataSourceDetail>;
  updateDataSource(id: string, input: DataSourceUpdateRequest): Promise<DataSourceDetail>;
  archiveDataSource(id: string): Promise<void>;
  listDataSourceAudioFiles(id: string): Promise<{ items: AudioFileSummary[] }>;
  listDataSourceIngestionRecords(id: string): Promise<{ items: DataSourceIngestionRecord[] }>;
  listDataSourceGroups(id: string): Promise<{ items: LinkedDataSourceGroup[] }>;
  linkDataSourceGroups(
    id: string,
    input: DataSourceGroupLinkRequest,
  ): Promise<{ items: LinkedDataSourceGroup[] }>;
  unlinkDataSourceGroup(id: string, groupId: string): Promise<void>;
  createDataSourceAudioUpload(
    id: string,
    items: StoredAudioUpload[],
  ): Promise<DataSourceAudioUploadResponse>;
  archiveDataSourceAudioFile(id: string, audioFileId: string): Promise<void>;
}
