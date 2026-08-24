/**
 * 音频工作区移动端测试固件。
 *
 * 为分组、数据源和分析页面提供通过共享契约形态的稳定服务器响应。
 *
 * Responsibilities:
 * - 集中复用跨 feature 的只读测试记录。
 *
 * Notes:
 * - 固件不会参与生产 bundle 的业务数据来源。
 */
import type {
  AudioAnalysisDetail,
  AudioFileSummary,
  DataSourceDetail,
  DataSourceIngestionRecord,
  DataSourceSummary,
  GroupSummary,
  KnowledgeBaseSummary,
  LinkedDataSourceGroup,
} from '@echowave/contracts';

export const groupFixture: GroupSummary = {
  id: '10000000-0000-4000-8000-000000000001',
  name: '产品研究组',
  metrics: { analysisCount: 2, audioCount: 5, knowledgeCount: 2, sourceCount: 3 },
  updatedAt: '2026-08-21T10:00:00.000Z',
};

export const knowledgeFixtures: KnowledgeBaseSummary[] = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    name: '产品研究知识库',
    description: '研究资料',
    documentCount: 2,
    linkedGroupCount: 1,
    updatedAt: '2026-08-19T00:00:00.000Z',
  },
  {
    id: 'b0000000-0000-4000-8000-000000000002',
    name: '团队文档空间',
    description: '团队资料',
    documentCount: 3,
    linkedGroupCount: 1,
    updatedAt: '2026-08-19T00:00:00.000Z',
  },
];

export const sourceFixtures: DataSourceSummary[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    name: '团队录音空间',
    description: '团队录音资料',
    sourceType: 'manual_upload',
    location: 'local',
    connectionLabel: 'HTTPS API / team-audio',
    connectionStatus: 'connected',
    linkedGroupCount: 3,
    lastUploadedAt: '2026-08-20T16:32:00.000Z',
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    name: '用户研究云盘',
    description: '研究资料',
    sourceType: 'cloud_drive',
    location: 'cloud',
    connectionLabel: 'Cloud Drive / research',
    connectionStatus: 'connected',
    linkedGroupCount: 2,
    lastUploadedAt: '2026-08-20T11:08:00.000Z',
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    name: '客户沟通归档',
    description: '客户录音',
    sourceType: 's3',
    location: 'cloud',
    connectionLabel: 'S3 / customer-calls',
    connectionStatus: 'connected',
    linkedGroupCount: 4,
    lastUploadedAt: '2026-08-19T18:45:00.000Z',
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    name: '市场调研资料',
    description: '市场资料',
    sourceType: 'local_folder',
    location: 'local',
    connectionLabel: 'Local Folder / market',
    connectionStatus: 'connected',
    linkedGroupCount: 1,
    lastUploadedAt: '2026-08-18T09:20:00.000Z',
  },
];

const baseAudio = (index: number, title: string): Omit<AudioFileSummary, 'status'> => ({
  id: `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  sourceId: sourceFixtures[0].id,
  title,
  durationMs: 1_104_000 + index * 1_000,
  createdAt: `2026-08-${21 - Math.ceil(index / 2)}T10:00:00.000Z`,
  sharedFrom: null,
  hasTranscript: false,
});

export const audioFixtures: AudioFileSummary[] = [
  { ...baseAudio(1, '产品访谈分析'), hasTranscript: true, status: { kind: 'ready' } },
  { ...baseAudio(2, '用户研究周会'), hasTranscript: true, status: { kind: 'ready' } },
  { ...baseAudio(3, '研究方案复盘'), status: { kind: 'uploading', progress: 40 } },
  { ...baseAudio(4, '新用户首次使用访谈'), status: { kind: 'transcribing', progress: 62 } },
  { ...baseAudio(5, '功能概念验证'), status: { kind: 'waiting' } },
  {
    ...baseAudio(6, '重点客户沟通'),
    status: {
      kind: 'failed',
      stage: 'transcription',
      code: 'UNSUPPORTED_CODEC',
      message: '音频编码暂不支持',
      retryable: false,
      details: {
        category: 'semantic_validation',
        chunkIndex: 2,
        chunkCount: 3,
        structureAttempts: 2,
        issues: [
          {
            path: 'segments.0.endMs',
            code: 'timestamp_out_of_bounds',
            message: '片段结束时间超出当前分块时长。',
          },
        ],
        outputLength: 128,
        outputSha256: 'a'.repeat(64),
      },
    },
  },
  { ...baseAudio(7, '竞品体验讨论'), status: { kind: 'uploading', progress: 25 } },
  { ...baseAudio(8, '市场活动复盘'), status: { kind: 'transcribing', progress: 34 } },
  {
    ...baseAudio(9, '渠道访谈录音'),
    status: {
      kind: 'failed',
      stage: 'upload',
      code: 'UPLOAD_FAILED',
      message: '音频上传失败',
      retryable: true,
      details: null,
    },
  },
];

export const dataSourceDetailFixture: DataSourceDetail = {
  ...sourceFixtures[0],
  metrics: { audioCount: 9, totalDurationMs: 22_680_000, transcribedCount: 2, pendingCount: 7 },
  settings: {
    transcriptionModel: 'google/gemini-2.5-flash-lite',
    autoTranscribe: true,
    emotionAnalysis: true,
    speakerDiarization: true,
    sceneSegmentation: true,
    skipInvalidAudio: true,
  },
};

export const ingestionFixtures: DataSourceIngestionRecord[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    kind: 'upload-success',
    occurredAt: '2026-08-20T16:32:08.000Z',
    audioCount: 3,
    totalDurationMs: 4_920_000,
    errorCode: null,
    errorMessage: null,
    retryable: false,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    kind: 'upload-failed',
    occurredAt: '2026-08-20T09:15:26.000Z',
    audioCount: 0,
    totalDurationMs: 0,
    errorCode: 'SOURCE_UNAVAILABLE',
    errorMessage: '文件连接已中断',
    retryable: true,
  },
  {
    id: '50000000-0000-4000-8000-000000000006',
    kind: 'transcription-failed',
    occurredAt: '2026-08-19T10:04:32.000Z',
    audioCount: 1,
    totalDurationMs: 2_112_000,
    errorCode: 'UNSUPPORTED_CODEC',
    errorMessage: '音频编码暂不支持',
    retryable: false,
  },
];

export const linkedGroupFixtures: LinkedDataSourceGroup[] = [
  { id: groupFixture.id, name: groupFixture.name, ...groupFixture.metrics },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: '客户体验组',
    analysisCount: 12,
    audioCount: 31,
    knowledgeCount: 2,
    sourceCount: 3,
  },
];

export const analysisFixture: AudioAnalysisDetail = {
  id: '50000000-0000-4000-8000-000000000001',
  audioFileId: audioFixtures[0].id,
  revision: 1,
  title: '产品访谈分析',
  durationMs: 1_104_000,
  generatedAt: '2026-08-15T10:51:24.000Z',
  invalidSegments: [
    {
      id: 'a0000000-0000-4000-8000-000000000001',
      startMs: 72_000,
      endMs: 84_000,
      reason: '无有效语音',
    },
  ],
  scenes: [
    {
      id: '60000000-0000-4000-8000-000000000001',
      index: 1,
      title: '开场与访谈背景',
      startMs: 0,
      segments: [
        {
          id: '70000000-0000-4000-8000-000000000001',
          index: 1,
          speakerKey: 'host',
          speakerLabel: '主持人',
          businessRole: '主持人',
          emotion: '专注',
          startMs: 0,
          endMs: 28_000,
          text: '今天想和你聊聊最近使用团队音频整理工具的体验。先从日常工作开始，你通常会在什么场景下记录和回听访谈？',
          aiTag: {
            id: '90000000-0000-4000-8000-000000000001',
            title: '高频访谈记录场景',
            summary: '音频整理是研究过程中的固定环节。',
            details: ['用户持续记录并在会后回顾。'],
          },
        },
        {
          id: '70000000-0000-4000-8000-000000000002',
          index: 2,
          speakerKey: 'self',
          speakerLabel: '我',
          businessRole: '客户',
          emotion: '平静',
          startMs: 29_000,
          endMs: 71_000,
          text: '最常见的是用户访谈和每周复盘。我会先完整录音，结束后再回听并整理重点，但在很长的录音里寻找关键内容会花不少时间。',
          aiTag: null,
        },
      ],
    },
  ],
  summarySections: [
    {
      id: '80000000-0000-4000-8000-000000000001',
      index: 1,
      title: '访谈背景',
      body: '本次访谈围绕团队音频记录与整理展开。',
    },
  ],
};
