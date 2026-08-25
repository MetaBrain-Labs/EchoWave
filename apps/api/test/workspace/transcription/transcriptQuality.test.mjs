/**
 * ASR 转写文本质量测试。
 *
 * 使用真实失败报告的退化模式验证重复、Markdown、密度和碎片检测，同时锁定正常口语
 * 与正常口语不会被误伤。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  analyzeTranscriptQuality,
  maximumSegmentsForDuration,
} from '../../../dist/workspace/transcription/transcriptQuality.js';

function segment(text, overrides = {}) {
  return {
    speakerKey: 'Speaker 0',
    emotion: 'neutral',
    startMs: 0,
    endMs: 60_000,
    text,
    ...overrides,
  };
}

describe('transcript quality validation', () => {
  it('detects every degeneration pattern observed in the failed execution report', () => {
    const scenarios = [
      {
        text: '比如说。醫療。的。那個、'.repeat(30),
        codes: ['repeated_text_loop', 'fragmented_text'],
      },
      { text: '*一万*，'.repeat(100), codes: ['repeated_text_loop', 'markdown_artifact'] },
      { text: '我也不想。'.repeat(40), codes: ['repeated_text_loop'] },
    ];

    for (const scenario of scenarios) {
      const result = analyzeTranscriptQuality([segment(scenario.text)], 60_000);
      const codes = result.issues.map(({ code }) => code);
      for (const code of scenario.codes)
        assert.ok(codes.includes(code), `${code} was not detected`);
      assert.ok(result.metrics.maximumRepetitionCoverage >= 0.35);
    }
  });

  it('rejects implausible text density and excessive segment counts', () => {
    const dense = analyzeTranscriptQuality(
      [segment('这是无法由一秒钟音频承载的正常转写内容'.repeat(8), { endMs: 1_000 })],
      1_000,
    );
    assert.ok(dense.issues.some(({ code }) => code === 'implausible_text_density'));

    const limit = maximumSegmentsForDuration(1_000);
    const crowded = analyzeTranscriptQuality(
      Array.from({ length: limit + 1 }, (_, index) =>
        segment(`片段${index}`, { startMs: index, endMs: index + 1 }),
      ),
      1_000,
    );
    assert.ok(crowded.issues.some(({ code }) => code === 'too_many_segments'));
  });

  it('accepts ordinary repeated sales wording and spoken punctuation names', () => {
    const result = analyzeTranscriptQuality(
      [
        segment(
          '这份保障是一万额度，住院是一万，意外也是一万。客户问星号一万星号是什么意思，销售进行了正常说明。',
          { endMs: 30_000 },
        ),
      ],
      30_000,
    );

    assert.deepEqual(result.issues, []);
    assert.equal(result.metrics.markdownArtifactCount, 0);
  });
});
