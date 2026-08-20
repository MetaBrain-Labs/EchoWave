/**
 * 分析详情演示数据。
 *
 * 为当前静态原型提供结构化中文内容和状态示例，使页面可以在无后端分析能力时运行。
 *
 * Responsibilities:
 * - 定义分析详情使用的本地只读记录。
 *
 * Notes:
 * - 所有记录均非服务器数据，不得作为持久化事实。
 */
/** AI 标签在演示分析中对应的解释和证据片段。 */
export type AiTagAnalysis = {
  title: string;
  summary: string;
  details: readonly string[];
};

/** 带时间范围和说话人的转写片段。 */
export type TranscriptSegment = {
  aiTag?: AiTagAnalysis;
  emotion: string;
  endSeconds: number;
  id: string;
  speaker: 'host' | 'self';
  speakerLabel: string;
  startSeconds: number;
  text: string;
};

/** 按业务场景聚合的一组转写片段。 */
export type TranscriptScene = {
  id: string;
  segments: readonly TranscriptSegment[];
  startSeconds: number;
  title: string;
};

/** 分析摘要中的一个结构化章节。 */
export type SummarySection = {
  body: string;
  id: string;
  title: string;
};

/** 分析详情原型使用的完整只读展示记录。 */
export type AnalysisDetail = {
  durationSeconds: number;
  generatedAt: string;
  id: string;
  invalidSegment?: {
    durationSeconds: number;
    startSeconds: number;
  };
  scenes: readonly TranscriptScene[];
  summarySections: readonly SummarySection[];
  title: string;
};

const scenes: readonly TranscriptScene[] = [
  {
    id: 'scene-opening',
    startSeconds: 0,
    title: '开场与访谈背景',
    segments: [
      {
        id: 'segment-opening-question',
        speaker: 'host',
        speakerLabel: '主持人',
        emotion: '专注',
        startSeconds: 0,
        endSeconds: 28,
        text: '今天想和你聊聊最近使用团队音频整理工具的体验。先从日常工作开始，你通常会在什么场景下记录和回听访谈？',
        aiTag: {
          title: '高频访谈记录场景',
          summary: '受访者的工作流程依赖持续记录和会后回顾，音频整理是研究过程中的固定环节。',
          details: [
            '主要场景包括用户访谈、项目复盘和跨团队评审。',
            '使用者希望保留原始语境，同时快速定位能够支持结论的片段。',
          ],
        },
      },
      {
        id: 'segment-opening-answer',
        speaker: 'self',
        speakerLabel: '我',
        emotion: '平静',
        startSeconds: 29,
        endSeconds: 71,
        text: '最常见的是用户访谈和每周复盘。我会先完整录音，结束后再回听并整理重点，但在很长的录音里寻找关键内容会花不少时间。',
      },
    ],
  },
  {
    id: 'scene-pain-points',
    startSeconds: 84,
    title: '整理痛点与期待',
    segments: [
      {
        id: 'segment-pain-question',
        speaker: 'host',
        speakerLabel: '主持人',
        emotion: '好奇',
        startSeconds: 84,
        endSeconds: 112,
        text: '如果工具可以自动完成一部分整理工作，你最希望它优先解决什么问题？',
        aiTag: {
          title: '优先需求：快速定位证据',
          summary: '用户最重视定位效率，希望分析结果能够回到原始转写和准确时间点。',
          details: [
            '总结需要与具体说话人、时间点和原始表达关联。',
            '标签应该帮助筛选，不应替代可核对的转写内容。',
          ],
        },
      },
      {
        id: 'segment-pain-answer',
        speaker: 'self',
        speakerLabel: '我',
        emotion: '期待',
        startSeconds: 113,
        endSeconds: 168,
        text: '我最希望先看到结构化的主题和关键观点，而且每条结论都能直接跳回对应的转写位置。这样既节省整理时间，也方便团队成员复核。',
      },
    ],
  },
];

const summarySections: readonly SummarySection[] = [
  {
    id: 'summary-background',
    title: '访谈背景',
    body: '本次访谈围绕团队音频记录、会后整理和研究结论复核展开。受访者会持续记录用户访谈、项目复盘与跨团队评审。',
  },
  {
    id: 'summary-workflow',
    title: '当前工作方式',
    body: '受访者通常先保留完整录音，再通过回听手动提炼重点。现有流程能够保留语境，但长音频中的关键内容定位成本较高。',
  },
  {
    id: 'summary-pain',
    title: '核心痛点',
    body: '最明显的问题是整理耗时和复核路径过长。只有总结而缺少原文、说话人与时间点关联时，团队成员很难快速确认结论。',
  },
  {
    id: 'summary-expectation',
    title: '产品期待',
    body: '用户希望系统自动识别主题、观点和关键证据，并允许从分析结果直接回到对应转写片段，同时保留筛选与人工核对能力。',
  },
  {
    id: 'summary-opportunity',
    title: '机会判断',
    body: '优先建设可追溯的结构化分析体验，比单纯生成长摘要更有价值。时间轴、说话人和 AI 标签应共同服务于快速定位与可信复核。',
  },
];

export const analysisDetails: Readonly<Record<string, AnalysisDetail>> = {
  'audio-1': {
    id: 'audio-1',
    title: '产品访谈分析',
    durationSeconds: 1104,
    generatedAt: '2026-08-15 10:51:24',
    invalidSegment: { startSeconds: 72, durationSeconds: 12 },
    scenes,
    summarySections,
  },
  'audio-2': {
    id: 'audio-2',
    title: '用户研究周会',
    durationSeconds: 2526,
    generatedAt: '2026-08-14 16:02:18',
    invalidSegment: { startSeconds: 72, durationSeconds: 12 },
    scenes,
    summarySections,
  },
};

/** 按 ID 返回稳定分析演示记录，不存在时回退到默认记录。 */
export function getAnalysisDetail(id: string) {
  return analysisDetails[id];
}
