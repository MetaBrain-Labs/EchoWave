/**
 * 分组页面查询与音频筛选模型。
 *
 * 将跨标签搜索、音频状态映射和时间排序保持为无副作用逻辑，供页面与测试复用。
 *
 * Responsibilities:
 * - 定义音频筛选和排序选项。
 * - 对三个分组子资源执行本地查询。
 *
 * Notes:
 * - 查询只作用于服务端已经返回的当前分组完整列表。
 */
import type {
  AudioFileSummary,
  AudioProcessingStatus,
  DataSourceSummary,
  KnowledgeBaseSummary,
} from '@echowave/contracts';

/** 资源时间排序方向。 */
export type ResourceSortOrder = 'newest' | 'oldest';
/** 音频创建时间排序方向。 */
export type AudioSortOrder = ResourceSortOrder;
/** 可用于多选筛选的统一音频状态。 */
export type AudioStatusKind = AudioProcessingStatus['kind'];
/** 知识库文档数量筛选。 */
export type KnowledgeDocumentFilter = 'all' | 'with-documents' | 'empty';
/** 数据源位置筛选。 */
export type DataSourceLocationKind = DataSourceSummary['location'];
/** 数据源连接状态筛选。 */
export type DataSourceStatusKind = DataSourceSummary['connectionStatus'];

/** 音频状态的中文查询与筛选标签。 */
export const audioStatusLabels: Record<AudioStatusKind, string> = {
  uploading: '上传中',
  waiting: '待分析',
  transcribing: '转写中',
  analyzing: '分析中',
  ready: '已完成',
  failed: '失败',
};

export const connectionStatusLabels: Record<DataSourceSummary['connectionStatus'], string> = {
  connected: '已连接',
  disconnected: '已断开',
  error: '连接错误',
  disabled: '已停用',
};

/** 数据源位置的中文搜索与筛选标签。 */
export const dataSourceLocationLabels: Record<DataSourceLocationKind, string> = {
  local: '本地',
  cloud: '云端',
};

function includesQuery(query: string, values: (string | null | undefined)[]) {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || values.some((value) => value?.toLocaleLowerCase().includes(normalized));
}

/** 按共享查询、状态和创建时间顺序生成音频展示列表。 */
export function selectAudioItems(
  items: AudioFileSummary[],
  query: string,
  statuses: ReadonlySet<AudioStatusKind>,
  sortOrder: AudioSortOrder,
) {
  return items
    .filter((item) =>
      includesQuery(query, [
        item.title,
        item.sharedFrom,
        audioStatusLabels[item.status.kind],
        item.status.kind === 'failed' ? item.status.message : null,
      ]),
    )
    .filter((item) => statuses.size === 0 || statuses.has(item.status.kind))
    .sort((left, right) => {
      const difference = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      return sortOrder === 'newest' ? difference : -difference;
    });
}

/** 按查询、文档状态和更新时间生成知识库展示列表。 */
export function selectKnowledgeBases(
  items: KnowledgeBaseSummary[],
  query: string,
  sortOrder: ResourceSortOrder = 'newest',
  documentFilter: KnowledgeDocumentFilter = 'all',
) {
  return items
    .filter((item) => includesQuery(query, [item.name, item.description]))
    .filter((item) => {
      if (documentFilter === 'with-documents') return item.documentCount > 0;
      if (documentFilter === 'empty') return item.documentCount === 0;
      return true;
    })
    .sort((left, right) => {
      const difference = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      return sortOrder === 'newest' ? difference : -difference;
    });
}

function compareNullableDates(
  left: string | null,
  right: string | null,
  sortOrder: ResourceSortOrder,
) {
  // 从未上传的数据源缺少可比较时间，无论排序方向都置于已有上传记录之后。
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const difference = new Date(right).getTime() - new Date(left).getTime();
  return sortOrder === 'newest' ? difference : -difference;
}

/** 按查询、位置、连接状态和最近上传时间生成数据源展示列表。 */
export function selectDataSources(
  items: DataSourceSummary[],
  query: string,
  sortOrder: ResourceSortOrder = 'newest',
  locations: ReadonlySet<DataSourceLocationKind> = new Set(),
  statuses: ReadonlySet<DataSourceStatusKind> = new Set(),
) {
  return items
    .filter((item) =>
      includesQuery(query, [
        item.name,
        item.description,
        item.connectionLabel,
        connectionStatusLabels[item.connectionStatus],
        dataSourceLocationLabels[item.location],
      ]),
    )
    .filter((item) => locations.size === 0 || locations.has(item.location))
    .filter((item) => statuses.size === 0 || statuses.has(item.connectionStatus))
    .sort((left, right) =>
      compareNullableDates(left.lastUploadedAt, right.lastUploadedAt, sortOrder),
    );
}
