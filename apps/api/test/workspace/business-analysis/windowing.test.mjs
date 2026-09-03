/**
 * 业务分析窗口规划测试。
 *
 * 覆盖长转写的片段数、字符数边界以及断点恢复所需的稳定索引。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUSINESS_ANALYSIS_WINDOW_MAX_CHARS,
  BUSINESS_ANALYSIS_WINDOW_MAX_SEGMENTS,
  buildBusinessAnalysisWindows,
} from '../../../dist/workspace/audio/business-analysis/windowing.js';

describe('buildBusinessAnalysisWindows', () => {
  it('keeps each speaker turn intact and caps both window dimensions', () => {
    const segments = Array.from(
      { length: BUSINESS_ANALYSIS_WINDOW_MAX_SEGMENTS + 1 },
      (_, index) => ({
        id: `${index}`,
        startMs: index * 1000,
        endMs: index * 1000 + 900,
        text: '内容',
      }),
    );
    const windows = buildBusinessAnalysisWindows(segments);
    assert.equal(windows.length, 2);
    assert.equal(windows[0].segments.length, BUSINESS_ANALYSIS_WINDOW_MAX_SEGMENTS);
    assert.equal(windows[1].index, 1);
    assert.deepEqual(
      windows.flatMap((window) => window.segments),
      segments,
    );
  });

  it('starts a new window before crossing the character budget', () => {
    const segments = [
      {
        id: 'a',
        startMs: 0,
        endMs: 1000,
        text: '甲'.repeat(BUSINESS_ANALYSIS_WINDOW_MAX_CHARS - 1),
      },
      { id: 'b', startMs: 1000, endMs: 2000, text: '乙乙' },
    ];
    const windows = buildBusinessAnalysisWindows(segments);
    assert.equal(windows.length, 2);
    assert.deepEqual(
      windows.map((window) => window.index),
      [0, 1],
    );
  });
});
