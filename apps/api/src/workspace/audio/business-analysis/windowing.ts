/**
 * 业务分析分层窗口规划。
 *
 * 按说话轮次边界把长转写拆成有上限的窗口，避免把整份长文本再次发送给模型。
 *
 * Responsibilities:
 * - 保持单个说话片段的完整性。
 * - 为窗口级 checkpoint 提供稳定索引和时间范围。
 *
 * Notes:
 * - 窗口只负责输入边界，不负责模型调用或结果持久化。
 */

export const BUSINESS_ANALYSIS_WINDOW_MAX_SEGMENTS = 50;
export const BUSINESS_ANALYSIS_WINDOW_MAX_CHARS = 6_000;

export type BusinessAnalysisWindowSegment = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type BusinessAnalysisWindow<
  T extends BusinessAnalysisWindowSegment = BusinessAnalysisWindowSegment,
> = {
  index: number;
  startMs: number;
  endMs: number;
  segments: T[];
};

/** 为业务分析生成最多 50 个片段且约 6000 字符的窗口，不拆散单个片段。 */
export function buildBusinessAnalysisWindows<T extends BusinessAnalysisWindowSegment>(
  segments: readonly T[],
): BusinessAnalysisWindow<T>[] {
  const windows: BusinessAnalysisWindow<T>[] = [];
  let current: T[] = [];
  let chars = 0;
  const flush = () => {
    if (current.length === 0) return;
    windows.push({
      index: windows.length,
      startMs: current[0]!.startMs,
      endMs: current[current.length - 1]!.endMs,
      segments: current,
    });
    current = [];
    chars = 0;
  };
  for (const segment of segments) {
    const textLength = segment.text.trim().length;
    const wouldExceed =
      current.length > 0 &&
      (current.length >= BUSINESS_ANALYSIS_WINDOW_MAX_SEGMENTS ||
        chars + textLength > BUSINESS_ANALYSIS_WINDOW_MAX_CHARS);
    if (wouldExceed) flush();
    current.push(segment);
    chars += textLength;
  }
  flush();
  return windows;
}
