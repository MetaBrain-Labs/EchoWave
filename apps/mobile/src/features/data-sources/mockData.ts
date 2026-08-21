/**
 * 数据源页面演示数据。
 *
 * 为数据源列表、详情、音频状态、上传记录和关联分组提供只读 presentation 数据。
 *
 * Responsibilities:
 * - 定义数据源前端原型使用的类型化展示模型。
 * - 提供稳定标识，支持列表与详情路由关联。
 *
 * Notes:
 * - 数据不来自服务器，也不会写入本地持久化存储。
 */

/** 数据源在列表中展示的接入位置。 */
export type DataSourceLocation = 'local' | 'cloud';

/** 数据源音频文件的前端处理状态。 */
export type SourceAudioStatus =
  | { kind: 'complete' }
  | { kind: 'uploading' }
  | { kind: 'transcribing'; progress: number }
  | { kind: 'waiting' }
  | { kind: 'upload-failed' }
  | { kind: 'transcription-failed' };

/** 数据源音频文件展示记录。 */
export type SourceAudioItem = {
  id: string;
  title: string;
  duration: string;
  createdAt: string;
  status: SourceAudioStatus;
};

/** 上传时间线中的记录类型。 */
export type UploadRecordKind =
  | 'upload-success'
  | 'upload-failed'
  | 'transcription-failed';

/** 数据源上传时间线记录。 */
export type UploadRecord = {
  id: string;
  date: string;
  time: string;
  kind: UploadRecordKind;
  description: string;
  detail: string;
};

/** 关联分组的统计展示模型。 */
export type LinkedSourceGroup = {
  id: string;
  name: string;
  analysisCount: number;
  audioCount: number;
  knowledgeCount: number;
  sourceCount: number;
};

/** 数据源列表与详情共用的摘要模型。 */
export type DataSourceSummary = {
  id: string;
  name: string;
  description: string;
  connection: string;
  location: DataSourceLocation;
  linkedGroupCount: number;
  uploadedAt: string;
};

/** 数据源详情页完整展示模型。 */
export type DataSourceDetail = DataSourceSummary & {
  analysisModel: string;
  autoTranscribe: boolean;
  emotionAnalysis: boolean;
  roleSeparation: boolean;
  sceneSeparation: boolean;
  skipInvalidAudio: boolean;
  audioItems: SourceAudioItem[];
  uploadRecords: UploadRecord[];
  linkedGroups: LinkedSourceGroup[];
};

export const dataSources: readonly DataSourceSummary[] = [
  {
    id: 'source-team-docs',
    name: '团队录音空间',
    description: '汇集团队访谈、周会与客户沟通录音，为分析任务持续提供统一的音频来源。',
    connection: 'HTTPS API / team-audio',
    location: 'local',
    linkedGroupCount: 3,
    uploadedAt: '2026-08-20 16:32',
  },
  {
    id: 'source-research-cloud',
    name: '用户研究云盘',
    description: '同步研究项目中的访谈音频与观察记录，保持各分组资料及时更新。',
    connection: 'Cloud Drive / research',
    location: 'cloud',
    linkedGroupCount: 2,
    uploadedAt: '2026-08-20 11:08',
  },
  {
    id: 'source-customer-calls',
    name: '客户沟通归档',
    description: '接入客户成功团队的沟通录音，用于提炼需求、异议和产品反馈。',
    connection: 'S3 / customer-calls',
    location: 'cloud',
    linkedGroupCount: 4,
    uploadedAt: '2026-08-19 18:45',
  },
  {
    id: 'source-market-notes',
    name: '市场调研资料',
    description: '整理市场活动与竞品调研录音，辅助趋势、场景和角色分析。',
    connection: 'Local Folder / market',
    location: 'local',
    linkedGroupCount: 1,
    uploadedAt: '2026-08-18 09:20',
  },
] as const;

const audioItems: SourceAudioItem[] = [
  { id: 'audio-1', title: '产品访谈第 12 期', duration: '32m 18s', createdAt: '2026-08-20', status: { kind: 'complete' } },
  { id: 'audio-2', title: '客户反馈周会', duration: '48m 06s', createdAt: '2026-08-20', status: { kind: 'complete' } },
  { id: 'audio-3', title: '研究方案复盘', duration: '26m 42s', createdAt: '2026-08-20', status: { kind: 'uploading' } },
  { id: 'audio-4', title: '新用户首次使用访谈', duration: '41m 05s', createdAt: '2026-08-19', status: { kind: 'transcribing', progress: 62 } },
  { id: 'audio-5', title: '功能概念验证', duration: '19m 38s', createdAt: '2026-08-19', status: { kind: 'waiting' } },
  { id: 'audio-6', title: '重点客户沟通', duration: '35m 12s', createdAt: '2026-08-18', status: { kind: 'transcription-failed' } },
  { id: 'audio-7', title: '竞品体验讨论', duration: '28m 54s', createdAt: '2026-08-18', status: { kind: 'uploading' } },
  { id: 'audio-8', title: '市场活动复盘', duration: '52m 20s', createdAt: '2026-08-17', status: { kind: 'transcribing', progress: 34 } },
  { id: 'audio-9', title: '渠道访谈录音', duration: '22m 47s', createdAt: '2026-08-17', status: { kind: 'upload-failed' } },
];

const uploadRecords: UploadRecord[] = [
  { id: 'upload-1', date: '2026-08-20', time: '16:32:08', kind: 'upload-success', description: '收到 3 条音频，共 1h 22m', detail: '已自动开始分析' },
  { id: 'upload-2', date: '2026-08-20', time: '11:08:41', kind: 'upload-success', description: '收到 2 条音频，共 58m 14s', detail: '已自动开始分析' },
  { id: 'upload-3', date: '2026-08-20', time: '09:15:26', kind: 'upload-failed', description: '文件连接已中断', detail: '来源暂时无法访问' },
  { id: 'upload-4', date: '2026-08-19', time: '18:45:13', kind: 'upload-success', description: '收到 4 条音频，共 2h 06m', detail: '已自动开始分析' },
  { id: 'upload-5', date: '2026-08-19', time: '14:22:57', kind: 'upload-success', description: '收到 1 条音频，共 35m 12s', detail: '已自动开始分析' },
  { id: 'upload-6', date: '2026-08-19', time: '10:04:32', kind: 'transcription-failed', description: '音频编码暂不支持', detail: '请转换格式后重新转写' },
];

const linkedGroups: LinkedSourceGroup[] = [
  { id: 'group-1', name: '产品研究组', analysisCount: 18, audioCount: 46, knowledgeCount: 3, sourceCount: 4 },
  { id: 'group-2', name: '客户体验组', analysisCount: 12, audioCount: 31, knowledgeCount: 2, sourceCount: 3 },
  { id: 'group-3', name: '市场洞察组', analysisCount: 9, audioCount: 24, knowledgeCount: 4, sourceCount: 5 },
];

export const dataSourceDetails: readonly DataSourceDetail[] = dataSources.map((source) => ({
  ...source,
  analysisModel: 'Echo ASR Standard',
  autoTranscribe: true,
  emotionAnalysis: true,
  roleSeparation: true,
  sceneSeparation: true,
  skipInvalidAudio: true,
  audioItems,
  uploadRecords,
  linkedGroups,
}));

/** 根据稳定路由标识读取数据源详情。 */
export function findDataSourceDetail(sourceId: string): DataSourceDetail | undefined {
  return dataSourceDetails.find((source) => source.id === sourceId);
}
