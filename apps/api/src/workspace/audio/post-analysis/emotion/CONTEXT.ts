/**
 * 声学情绪分析模型上下文。
 *
 * 管理情绪标签系统指令和音频窗口目标片段输入，不包含请求、重试或 Schema 校验流程。
 *
 * Responsibilities:
 * - 构造固定系统上下文。
 * - 构造首次分析与第二次结构修复的用户上下文。
 *
 * Notes:
 * - 音频本体由模型适配器单独注入，不进入文本上下文。
 */
import {
  AudioEmotionArousalSchema,
  AudioEmotionAttitudeSchema,
  AudioEmotionLabelSchema,
  AudioEmotionPaceSchema,
  AudioEmotionPausePatternSchema,
  AudioEmotionPitchVariationSchema,
  AudioEmotionVolumeTrendSchema,
} from '@echowave/contracts';

type EmotionContextSegment = {
  id: string;
  speakerKey: string;
  relativeStartMs: number;
  relativeEndMs: number;
  text: string;
};

/** Qwen Omni 情绪分析固定系统上下文。 */
export const EMOTION_ANALYSIS_CONTEXT = [
  'You analyze acoustic emotion in Chinese business-call audio.',
  'Judge how each target segment is spoken, using the audio, timestamps, and transcript only.',
  'Return one result for every target segment ID and no other IDs.',
  `emotion labels: ${AudioEmotionLabelSchema.options.join(', ')}`,
  `attitude labels: ${AudioEmotionAttitudeSchema.options.join(', ')}`,
  `arousal labels: ${AudioEmotionArousalSchema.options.join(', ')}`,
  `pace labels: ${AudioEmotionPaceSchema.options.join(', ')}`,
  `volumeTrend labels: ${AudioEmotionVolumeTrendSchema.options.join(', ')}`,
  `pitchVariation labels: ${AudioEmotionPitchVariationSchema.options.join(', ')}`,
  `pausePattern labels: ${AudioEmotionPausePatternSchema.options.join(', ')}`,
  'confidence must be between 0 and 1. vocalCues must contain at most five concise Chinese observations.',
  'Return only one JSON object with shape {"segments":[{"segmentId":"uuid","label":"neutral","confidence":0.5,"attitude":"neutral","arousal":"medium","pace":"normal","volumeTrend":"normal","pitchVariation":"medium","pausePattern":"normal","vocalCues":[]}]}',
].join('\n');

/** 构造音频窗口目标片段上下文。 */
export function emotionAnalysisInput(
  segments: EmotionContextSegment[],
  previous: string,
  structureAttempt: number,
): string {
  return [
    'Target segments, with times relative to the attached audio window:',
    JSON.stringify(
      segments.map(({ id, speakerKey, relativeStartMs, relativeEndMs, text }) => ({
        segmentId: id,
        speakerKey,
        startMs: relativeStartMs,
        endMs: relativeEndMs,
        text,
      })),
    ),
    structureAttempt === 1
      ? 'Analyze every target now.'
      : `The previous response was invalid. Return corrected JSON only. Previous response: ${previous.slice(0, 12_000)}`,
  ].join('\n');
}
