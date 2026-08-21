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

/** 音频创建时间排序方向。 */
export type AudioSortOrder = 'newest' | 'oldest';
/** 可用于多选筛选的统一音频状态。 */
export type AudioStatusKind = AudioProcessingStatus['kind'];

/** 音频状态的中文查询与筛选标签。 */
export const audioStatusLabels: Record<AudioStatusKind, string> = {
  uploading: '上传中',
  waiting: '待分析',
  transcribing: '转写中',
  analyzing: '分析中',
  ready: '已完成',
  failed: '失败',
};

const connectionStatusLabels: Record<DataSourceSummary['connectionStatus'], string> = {
  connected: '已连接',
  disconnected: '已断开',
  error: '连接错误',
  disabled: '已停用',
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
    .filter((item) => includesQuery(query, [
      item.title,
      item.sharedFrom,
      audioStatusLabels[item.status.kind],
      item.status.kind === 'failed' ? item.status.message : null,
    ]))
    .filter((item) => statuses.size === 0 || statuses.has(item.status.kind))
    .sort((left, right) => {
      const difference = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      return sortOrder === 'newest' ? difference : -difference;
    });
}

/** 按名称和描述搜索当前分组的知识库。 */
export function selectKnowledgeBases(items: KnowledgeBaseSummary[], query: string) {
  return items.filter((item) => includesQuery(query, [item.name, item.description]));
}

/** 按名称、描述、连接标签和中文连接状态搜索当前分组的数据源。 */
export function selectDataSources(items: DataSourceSummary[], query: string) {
  return items.filter((item) => includesQuery(query, [
    item.name,
    item.description,
    item.connectionLabel,
    connectionStatusLabels[item.connectionStatus],
  ]));
}
