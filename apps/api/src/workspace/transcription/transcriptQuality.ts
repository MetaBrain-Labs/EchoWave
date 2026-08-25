/**
 * ASR 转写文本质量校验。
 *
 * 对已经通过 JSON 和基础时间戳校验的模型结果执行高精度退化检测，并合并同一说话人
 * 的相邻碎片。模块只返回安全统计和稳定问题码，不返回或记录触发问题的原始短语。
 *
 * Responsibilities:
 * - 检测重复循环、异常文本密度、Markdown 产物、严重碎片化和过多片段。
 * - 为服务端校验提供按音频时长计算的片段数量上限。
 *
 * Notes:
 * - 中文简繁体不属于服务端失败条件，文字体系只通过模型提示进行最佳努力约束。
 */
import type { AudioFailureIssue } from '@echowave/contracts';

const MINIMUM_REPETITION_CHARACTERS = 80;
const MINIMUM_REPETITION_OCCURRENCES = 8;
const REPETITION_COVERAGE_THRESHOLD = 0.35;
const MAXIMUM_CHARACTERS_PER_SECOND = 40;

/** 质量校验所需的最小转写片段形状。 */
export type TranscriptQualitySegment = {
  speakerKey: string;
  emotion: string;
  startMs: number;
  endMs: number;
  text: string;
};

/** 可安全写入执行报告的转写质量统计。 */
export type TranscriptQualityMetrics = {
  segmentCount: number;
  coalescedSegmentCount: number;
  segmentLimit: number;
  normalizedCharacterCount: number;
  charactersPerSecond: number;
  maximumSegmentCharactersPerSecond: number;
  maximumRepetitionCoverage: number;
  markdownArtifactCount: number;
  fragmentedSegmentCount: number;
};

/** 转写质量校验结果；问题中不包含模型正文。 */
export type TranscriptQualityResult = {
  issues: AudioFailureIssue[];
  metrics: TranscriptQualityMetrics;
};

/** 按音频时长给出极宽松但有界的连续 Speaker turn 数量上限。 */
export function maximumSegmentsForDuration(durationMs: number): number {
  return Math.max(16, Math.min(240, Math.ceil((durationMs / 1_000) * 2)));
}

function normalizedCharacters(value: string): string[] {
  return Array.from(value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ''));
}

function repetitionCoverage(value: string): number {
  const characters = normalizedCharacters(value);
  if (characters.length < MINIMUM_REPETITION_CHARACTERS) return 0;
  let maximumCoverage = 0;
  for (let size = 2; size <= Math.min(12, characters.length); size += 1) {
    const counts = new Map<string, number>();
    for (let index = 0; index <= characters.length - size; index += 1) {
      const gram = characters.slice(index, index + size).join('');
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    for (const count of counts.values()) {
      if (count < MINIMUM_REPETITION_OCCURRENCES) continue;
      maximumCoverage = Math.max(maximumCoverage, Math.min(1, (count * size) / characters.length));
    }
  }
  return maximumCoverage;
}

function markdownArtifactCount(value: string): number {
  return Array.from(value.matchAll(/```|`[^`\n]+`|\*{1,2}[^*\n]+\*{1,2}|_{2}[^_\n]+_{2}/gu)).length;
}

function isFragmented(value: string): boolean {
  const clauses = value
    .split(/[。！？!?；;，,、]+/u)
    .map((clause) => normalizedCharacters(clause).length)
    .filter((length) => length > 0);
  if (clauses.length < 12) return false;
  const shortClauses = clauses.filter((length) => length <= 3).length;
  return shortClauses >= 8 && shortClauses / clauses.length >= 0.6;
}

/** 检测明显不可能来自当前音频的退化文本，并返回安全统计。 */
export function analyzeTranscriptQuality(
  segments: TranscriptQualitySegment[],
  durationMs: number,
  originalSegmentCount = segments.length,
): TranscriptQualityResult {
  const issues: AudioFailureIssue[] = [];
  const segmentLimit = maximumSegmentsForDuration(durationMs);
  if (originalSegmentCount > segmentLimit) {
    issues.push({
      path: 'segments',
      code: 'too_many_segments',
      message: `模型返回的片段数超过当前音频允许的 ${segmentLimit} 条上限。`,
    });
  }

  const normalizedCharacterCount = segments.reduce(
    (total, segment) => total + normalizedCharacters(segment.text).length,
    0,
  );
  const durationSeconds = Math.max(0.25, durationMs / 1_000);
  const charactersPerSecond = normalizedCharacterCount / durationSeconds;
  if (normalizedCharacterCount >= 40 && charactersPerSecond > MAXIMUM_CHARACTERS_PER_SECOND) {
    issues.push({
      path: 'segments',
      code: 'implausible_text_density',
      message: '模型返回的文本量明显超过当前音频时长可承载的范围。',
    });
  }

  let maximumSegmentCharactersPerSecond = 0;
  let maximumRepetitionCoverage = repetitionCoverage(segments.map(({ text }) => text).join(''));
  let markdownArtifacts = 0;
  let fragmentedSegmentCount = 0;
  let chunkRepetitionReported = false;
  for (const [index, segment] of segments.entries()) {
    const normalizedLength = normalizedCharacters(segment.text).length;
    const segmentDurationSeconds = Math.max(0.25, (segment.endMs - segment.startMs) / 1_000);
    const segmentCharactersPerSecond = normalizedLength / segmentDurationSeconds;
    maximumSegmentCharactersPerSecond = Math.max(
      maximumSegmentCharactersPerSecond,
      segmentCharactersPerSecond,
    );
    if (normalizedLength >= 40 && segmentCharactersPerSecond > MAXIMUM_CHARACTERS_PER_SECOND) {
      issues.push({
        path: `segments.${index}.text`,
        code: 'implausible_text_density',
        message: '片段文本量与对应时间范围明显不匹配。',
      });
    }

    const coverage = repetitionCoverage(segment.text);
    maximumRepetitionCoverage = Math.max(maximumRepetitionCoverage, coverage);
    if (coverage >= REPETITION_COVERAGE_THRESHOLD) {
      chunkRepetitionReported = true;
      issues.push({
        path: `segments.${index}.text`,
        code: 'repeated_text_loop',
        message: '模型输出出现大范围重复循环。',
      });
    }

    const artifacts = markdownArtifactCount(segment.text);
    markdownArtifacts += artifacts;
    if (artifacts > 0) {
      issues.push({
        path: `segments.${index}.text`,
        code: 'markdown_artifact',
        message: '模型转写正文包含不应出现的 Markdown 标记。',
      });
    }

    if (isFragmented(segment.text)) {
      fragmentedSegmentCount += 1;
      issues.push({
        path: `segments.${index}.text`,
        code: 'fragmented_text',
        message: '模型输出包含大量异常短句碎片。',
      });
    }
  }

  if (!chunkRepetitionReported && maximumRepetitionCoverage >= REPETITION_COVERAGE_THRESHOLD) {
    issues.push({
      path: 'segments',
      code: 'repeated_text_loop',
      message: '模型输出在多个片段间出现大范围重复循环。',
    });
  }

  return {
    issues: issues.slice(0, 20),
    metrics: {
      segmentCount: originalSegmentCount,
      coalescedSegmentCount: segments.length,
      segmentLimit,
      normalizedCharacterCount,
      charactersPerSecond: Number(charactersPerSecond.toFixed(2)),
      maximumSegmentCharactersPerSecond: Number(maximumSegmentCharactersPerSecond.toFixed(2)),
      maximumRepetitionCoverage: Number(maximumRepetitionCoverage.toFixed(4)),
      markdownArtifactCount: markdownArtifacts,
      fragmentedSegmentCount,
    },
  };
}
