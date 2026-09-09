/**
 * 说话人疑点复核模型上下文。
 *
 * 构造只允许选择真实片段与词边界的英文模型输入，不包含调用、重试或持久化逻辑。
 *
 * Responsibilities:
 * - 提供词索引化的候选转写。
 * - 约束模型只能报告疑点，不能修改 Speaker。
 */
import type { SupportedLanguage } from '@echowave/contracts';

export type SpeakerReviewContextCandidate = {
  segmentId: string;
  speakerKey: string;
  splitAfterWordIndex: number;
  leftContext: { index: number; text: string; punctuation: string }[];
  rightContext: { index: number; text: string; punctuation: string }[];
};

/** 构造说话人边界复核提示。 */
export function speakerReviewContext(
  candidates: SpeakerReviewContextCandidate[],
  language: SupportedLanguage = 'zh-CN',
): string {
  return [
    `Review this ${language === 'zh-CN' ? 'Chinese' : 'English'} sales-call transcript for possible speaker changes that ASR merged into one speaker segment.`,
    'Text semantics are not acoustic identity. Only flag boundaries that a human should review; never assert or rewrite a speaker.',
    'Every result must select an exact supplied segmentId and splitAfterWordIndex candidate. Do not create another boundary.',
    'Use severity medium or high and one reasonCode: question_answer_transition, long_internal_pause, or dialogue_pattern.',
    `Write explanation in ${language === 'zh-CN' ? 'Simplified Chinese' : 'English'}. Return only JSON: {"findings":[{"segmentId":"uuid","splitAfterWordIndex":0,"severity":"medium","reasonCode":"dialogue_pattern","explanation":"short explanation"}]}`,
    `Candidates: ${JSON.stringify(candidates)}`,
  ].join('\n');
}
