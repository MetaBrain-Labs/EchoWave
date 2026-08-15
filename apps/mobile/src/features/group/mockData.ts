/** View-only sample records used to demonstrate the first mobile vertical slice. */
export type AudioStatus =
  | { kind: 'complete'; duration: string }
  | { kind: 'waiting' }
  | { kind: 'uploading' }
  | { kind: 'analyzing'; progress: number };

export type AudioItem = {
  id: string;
  title: string;
  createdAt: string;
  sharedFrom?: string;
  status: AudioStatus;
};

export const audioItems: AudioItem[] = [
  {
    id: 'audio-1',
    title: '产品访谈分析',
    createdAt: '2026-08-15 10:32',
    status: { kind: 'complete', duration: '18m 24s' },
  },
  {
    id: 'audio-2',
    title: '用户研究周会',
    createdAt: '2026-08-14 15:08',
    sharedFrom: '产品研究组',
    status: { kind: 'complete', duration: '42m 06s' },
  },
  {
    id: 'audio-3',
    title: '待整理录音',
    createdAt: '2026-08-14 09:16',
    status: { kind: 'waiting' },
  },
  {
    id: 'audio-4',
    title: '客户反馈录音',
    createdAt: '2026-08-13 17:42',
    status: { kind: 'uploading' },
  },
  {
    id: 'audio-5',
    title: '竞品分析讨论',
    createdAt: '2026-08-13 11:05',
    status: { kind: 'analyzing', progress: 62 },
  },
];

export const knowledgeBases = [
  {
    id: 'kb-1',
    name: '产品研究知识库',
    description: '沉淀用户访谈、需求洞察与产品策略相关资料。',
    documentCount: 26,
    updatedAt: '2026-08-15',
  },
  {
    id: 'kb-2',
    name: '行业趋势知识库',
    description: '汇总行业报告、竞品动态与市场研究资料。',
    documentCount: 18,
    updatedAt: '2026-08-12',
  },
  {
    id: 'kb-3',
    name: '团队项目知识库',
    description: '保存项目纪要、决策记录和团队协作文档。',
    documentCount: 41,
    updatedAt: '2026-08-10',
  },
] as const;

export const dataSources = [
  {
    id: 'source-1',
    name: '团队文档空间',
    description: '同步团队共享文档，为分析任务提供背景上下文。',
    connection: 'HTTPS API / team-docs',
    uploadedAt: '2026-08-15 09:20',
  },
  {
    id: 'source-2',
    name: '访谈资料归档',
    description: '连接历史访谈与调研附件，统一管理原始资料。',
    connection: 'HTTPS API / interviews',
    uploadedAt: '2026-08-14 18:10',
  },
  {
    id: 'source-3',
    name: '市场研究数据',
    description: '接入市场调研数据，用于辅助趋势与竞品分析。',
    connection: 'HTTPS API / market-data',
    uploadedAt: '2026-08-12 14:45',
  },
] as const;
