/**
 * 说话人切换疑点本地规则。
 *
 * 从供应商原始 Speaker 与词级时间线中提取可解释的录音级和词边界级复核候选，
 * 不修改说话人归属。
 *
 * Responsibilities:
 * - 标记单 Speaker 录音这一客观事实。
 * - 识别段内问答转折和明显词间停顿。
 */
import type { TranscriptDraft } from '../transcription/repository.ts';

/** 发布前使用的说话人复核疑点。 */
export type SpeakerReviewFindingDraft = {
  sourceSegmentIndex: number | null;
  splitAfterWordIndex: number | null;
  severity: 'medium' | 'high';
  reasonCode:
    | 'single_speaker_recording'
    | 'question_answer_transition'
    | 'long_single_speaker_segment'
    | 'long_internal_pause'
    | 'dialogue_pattern';
  explanation: string;
  source: 'rule' | 'model';
};

const QUESTION_CUE = /(怎么|什么|吗|呢|多少|几|是否|能不能|可不可以|有没有|哪)/u;
const ANSWER_CUE = /^(对|是|可以|这种|这个|那个|我们|直接|先|打开|需要|建议)/u;
const STRONG_BOUNDARY = /[?？]/u;
const CLAUSE_BOUNDARY = /[，,。.!！；;]/u;
const LONG_INTERNAL_PAUSE_MS = 700;

function textThrough(segment: TranscriptDraft, wordIndex: number): string {
  return segment.words
    .slice(0, wordIndex + 1)
    .map((word) => `${word.text}${word.punctuation}`)
    .join('')
    .trim();
}

function textAfter(segment: TranscriptDraft, wordIndex: number): string {
  return segment.words
    .slice(wordIndex + 1)
    .map((word) => `${word.text}${word.punctuation}`)
    .join('')
    .trim();
}

/** 生成不会自动改写 Speaker 的保守疑点集合。 */
export function detectSpeakerReviewCandidates(
  segments: readonly TranscriptDraft[],
): SpeakerReviewFindingDraft[] {
  const findings: SpeakerReviewFindingDraft[] = [];
  if (new Set(segments.map((segment) => segment.speakerKey)).size === 1) {
    findings.push({
      sourceSegmentIndex: null,
      splitAfterWordIndex: null,
      severity: 'medium',
      reasonCode: 'single_speaker_recording',
      explanation: '本录音仅识别到 1 位说话人，请结合原音检查是否存在漏分。',
      source: 'rule',
    });
  }

  segments.forEach((segment, sourceSegmentIndex) => {
    if (
      segment.words.length > 1 &&
      (segment.endMs - segment.startMs >= 30_000 || segment.text.length >= 120)
    ) {
      findings.push({
        sourceSegmentIndex,
        splitAfterWordIndex: Math.floor(segment.words.length / 2) - 1,
        severity: 'medium',
        reasonCode: 'long_single_speaker_segment',
        explanation: '同一 Speaker 连续片段较长，建议从中部开始回听是否存在漏分。',
        source: 'rule',
      });
    }
    for (let wordIndex = 0; wordIndex < segment.words.length - 1; wordIndex += 1) {
      const word = segment.words[wordIndex]!;
      const next = segment.words[wordIndex + 1]!;
      const left = textThrough(segment, wordIndex);
      const right = textAfter(segment, wordIndex);
      if (STRONG_BOUNDARY.test(word.punctuation) && QUESTION_CUE.test(left) && right) {
        findings.push({
          sourceSegmentIndex,
          splitAfterWordIndex: wordIndex,
          severity: ANSWER_CUE.test(right) ? 'high' : 'medium',
          reasonCode: 'question_answer_transition',
          explanation: '同一 Speaker 段内出现连续的提问与回答语义，建议回听边界。',
          source: 'rule',
        });
        continue;
      }
      if (next.startMs - word.endMs >= LONG_INTERNAL_PAUSE_MS) {
        findings.push({
          sourceSegmentIndex,
          splitAfterWordIndex: wordIndex,
          severity: 'medium',
          reasonCode: 'long_internal_pause',
          explanation: '同一 Speaker 段内存在明显停顿，可能是未识别的说话轮次切换。',
          source: 'rule',
        });
        continue;
      }
      if (
        CLAUSE_BOUNDARY.test(word.punctuation) &&
        QUESTION_CUE.test(left) &&
        ANSWER_CUE.test(right)
      ) {
        findings.push({
          sourceSegmentIndex,
          splitAfterWordIndex: wordIndex,
          severity: 'medium',
          reasonCode: 'dialogue_pattern',
          explanation: '相邻分句呈现问答角色切换特征，建议结合原音确认。',
          source: 'rule',
        });
      }
    }
  });

  const unique = new Map<string, SpeakerReviewFindingDraft>();
  for (const finding of findings) {
    const key = `${finding.sourceSegmentIndex ?? 'recording'}:${finding.splitAfterWordIndex ?? 'none'}`;
    const previous = unique.get(key);
    if (!previous || (previous.severity === 'medium' && finding.severity === 'high')) {
      unique.set(key, finding);
    }
  }
  return [...unique.values()];
}
