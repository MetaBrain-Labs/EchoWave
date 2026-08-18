/** Local presentation data for the knowledge-library prototype; nothing is server-backed. */
export type DocumentStatus =
  | { kind: 'complete'; parsedAt: string }
  | { kind: 'waiting' }
  | { kind: 'uploading' }
  | { kind: 'parsing'; progress: number }
  | { kind: 'failed'; reason: string };

export type DocumentFormat = 'markdown' | 'word' | 'spreadsheet' | 'text';

export type ParsedBlock = {
  charCount: number;
  content: string;
  id: string;
  index: number;
  line: number;
  page: number;
  sourceExcerpt: string;
  title: string;
  vectorId: string;
};

export type DocumentPreview = {
  markdownSource: string;
  sections: readonly { body: string; id: string; title: string }[];
  title: string;
};

export type KnowledgeDocument = {
  blocks: readonly ParsedBlock[];
  format: DocumentFormat;
  id: string;
  preview: DocumentPreview;
  size: string;
  status: DocumentStatus;
  title: string;
  updatedAt: string;
  vectorCount: number;
};

export type LinkedGroup = {
  analysisCount: number;
  audioCount: number;
  dataSourceCount: number;
  id: string;
  knowledgeCount: number;
  name: string;
};

export type KnowledgeBase = {
  description: string;
  documentCount: number;
  documents: readonly KnowledgeDocument[];
  id: string;
  linkedGroupCount: number;
  linkedGroups: readonly LinkedGroup[];
  name: string;
  updatedAt: string;
};

const previewSections = [
  {
    id: 'section-background',
    title: '研究背景',
    body: '团队正在梳理音频访谈从记录、转写到结论复核的完整工作流，并评估自动分析在研究协作中的价值。',
  },
  {
    id: 'section-process',
    title: '当前流程',
    body: '研究人员通常先保存完整录音，再人工回听并整理主题。长音频中的关键证据定位耗时，是当前最明显的效率问题。',
  },
  {
    id: 'section-needs',
    title: '核心需求',
    body: '分析结果需要关联说话人、原始表达与准确时间点，让团队成员能够快速核对结论并继续补充研究判断。',
  },
  {
    id: 'section-opportunity',
    title: '产品机会',
    body: '优先提供可追溯的结构化主题、文本块和来源定位，比只生成一份无法复核的长摘要更有实际价值。',
  },
] as const;

const productInterviewPreview: DocumentPreview = {
  title: '音频访谈整理研究',
  sections: previewSections,
  markdownSource:
    '# 音频访谈整理研究\n\n## 研究背景\n团队正在梳理音频访谈的完整工作流。\n\n## 当前流程\n研究人员先保存完整录音，再人工回听并整理主题。\n\n## 核心需求\n分析结果需要关联原始表达与准确时间点。',
};

const productInterviewBlocks: readonly ParsedBlock[] = [
  {
    id: 'block-background',
    index: 1,
    title: '研究背景',
    content: '团队正在梳理音频访谈从记录、转写到结论复核的完整工作流，并评估自动分析在研究协作中的价值。',
    vectorId: 'vec-7f31a8',
    charCount: 52,
    page: 1,
    line: 3,
    sourceExcerpt: '团队正在梳理音频访谈从记录、转写到结论复核的完整工作流，并评估自动分析在研究协作中的价值。',
  },
  {
    id: 'block-process',
    index: 2,
    title: '当前流程',
    content: '研究人员通常先保存完整录音，再人工回听并整理主题。长音频中的关键证据定位耗时，是当前最明显的效率问题。',
    vectorId: 'vec-b125c4',
    charCount: 55,
    page: 1,
    line: 8,
    sourceExcerpt: '研究人员通常先保存完整录音，再人工回听并整理主题。长音频中的关键证据定位耗时。',
  },
  {
    id: 'block-needs',
    index: 3,
    title: '核心需求',
    content: '分析结果需要关联说话人、原始表达与准确时间点，让团队成员能够快速核对结论并继续补充研究判断。',
    vectorId: 'vec-391d72',
    charCount: 50,
    page: 2,
    line: 4,
    sourceExcerpt: '分析结果需要关联说话人、原始表达与准确时间点，让团队成员能够快速核对结论。',
  },
  {
    id: 'block-opportunity',
    index: 4,
    title: '产品机会',
    content: '优先提供可追溯的结构化主题、文本块和来源定位，比只生成一份无法复核的长摘要更有实际价值。',
    vectorId: 'vec-da2046',
    charCount: 48,
    page: 2,
    line: 10,
    sourceExcerpt: '优先提供可追溯的结构化主题、文本块和来源定位，比只生成一份长摘要更有实际价值。',
  },
];

const linkedGroups: readonly LinkedGroup[] = [
  {
    id: 'group-product',
    name: '产品研究组',
    analysisCount: 18,
    audioCount: 26,
    knowledgeCount: 3,
    dataSourceCount: 4,
  },
  {
    id: 'group-customer',
    name: '客户体验组',
    analysisCount: 12,
    audioCount: 20,
    knowledgeCount: 2,
    dataSourceCount: 3,
  },
  {
    id: 'group-strategy',
    name: '产品策略组',
    analysisCount: 9,
    audioCount: 14,
    knowledgeCount: 4,
    dataSourceCount: 2,
  },
] as const;

const productDocuments: readonly KnowledgeDocument[] = [
  {
    id: 'doc-interview-workflow',
    title: '音频访谈整理研究',
    format: 'markdown',
    size: '184 KB',
    updatedAt: '2026-08-15',
    status: { kind: 'complete', parsedAt: '2026-08-15 11:08:36' },
    vectorCount: 4,
    blocks: productInterviewBlocks,
    preview: productInterviewPreview,
  },
  {
    id: 'doc-research-plan',
    title: '用户研究执行计划',
    format: 'markdown',
    size: '96 KB',
    updatedAt: '2026-08-14',
    status: { kind: 'complete', parsedAt: '2026-08-14 16:22:10' },
    vectorCount: 4,
    blocks: productInterviewBlocks,
    preview: { ...productInterviewPreview, title: '用户研究执行计划' },
  },
  {
    id: 'doc-weekly-review',
    title: '研究周会纪要',
    format: 'markdown',
    size: '72 KB',
    updatedAt: '2026-08-14',
    status: { kind: 'waiting' },
    vectorCount: 0,
    blocks: [],
    preview: productInterviewPreview,
  },
  {
    id: 'doc-feedback',
    title: '客户反馈汇总',
    format: 'word',
    size: '1.8 MB',
    updatedAt: '2026-08-13',
    status: { kind: 'uploading' },
    vectorCount: 0,
    blocks: [],
    preview: productInterviewPreview,
  },
  {
    id: 'doc-market',
    title: '市场竞品观察表',
    format: 'spreadsheet',
    size: '640 KB',
    updatedAt: '2026-08-12',
    status: { kind: 'parsing', progress: 62 },
    vectorCount: 0,
    blocks: [],
    preview: productInterviewPreview,
  },
  {
    id: 'doc-archive',
    title: '历史访谈归档说明',
    format: 'text',
    size: '42 KB',
    updatedAt: '2026-08-10',
    status: { kind: 'failed', reason: '文件编码无法识别' },
    vectorCount: 0,
    blocks: [],
    preview: productInterviewPreview,
  },
];

export const knowledgeBases: readonly KnowledgeBase[] = [
  {
    id: 'kb-1',
    name: '产品研究知识库',
    description: '沉淀用户访谈、需求洞察与产品策略资料，帮助团队复核研究证据并持续积累产品认知。',
    documentCount: productDocuments.length,
    linkedGroupCount: linkedGroups.length,
    updatedAt: '2026-08-15',
    documents: productDocuments,
    linkedGroups,
  },
  {
    id: 'kb-2',
    name: '行业趋势知识库',
    description: '汇总行业报告、竞品动态和市场研究资料，为产品规划提供外部趋势参考。',
    documentCount: 18,
    linkedGroupCount: 2,
    updatedAt: '2026-08-12',
    documents: productDocuments.slice(0, 2),
    linkedGroups: linkedGroups.slice(0, 2),
  },
  {
    id: 'kb-3',
    name: '团队项目知识库',
    description: '保存项目纪要、决策记录与交付文档，让跨团队协作信息保持可追溯。',
    documentCount: 41,
    linkedGroupCount: 3,
    updatedAt: '2026-08-10',
    documents: productDocuments.slice(0, 3),
    linkedGroups,
  },
  {
    id: 'kb-4',
    name: '客户洞察知识库',
    description: '集中管理客户反馈、支持记录与满意度研究，持续跟踪体验变化。',
    documentCount: 23,
    linkedGroupCount: 2,
    updatedAt: '2026-08-08',
    documents: productDocuments.slice(0, 2),
    linkedGroups: linkedGroups.slice(0, 2),
  },
] as const;

export function getKnowledgeBase(knowledgeId: string) {
  return knowledgeBases.find((knowledge) => knowledge.id === knowledgeId);
}

export function getKnowledgeDocument(knowledgeId: string, documentId: string) {
  return getKnowledgeBase(knowledgeId)?.documents.find(
    (document) => document.id === documentId,
  );
}

export function getParsedBlock(
  knowledgeId: string,
  documentId: string,
  blockId: string,
) {
  return getKnowledgeDocument(knowledgeId, documentId)?.blocks.find(
    (block) => block.id === blockId,
  );
}
