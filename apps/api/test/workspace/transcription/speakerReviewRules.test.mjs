/**
 * 说话人疑点规则测试。
 *
 * 验证问答文本只产生复核标签，不会直接改写供应商 Speaker。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectSpeakerReviewCandidates } from '../../../dist/workspace/audio/speaker-review/rules.js';

describe('detectSpeakerReviewCandidates', () => {
  it('marks the customer-question example without changing the transcript', () => {
    const segment = {
      speakerKey: 'Speaker 0',
      businessRole: 'unknown',
      emotion: 'unknown',
      startMs: 0,
      endMs: 2_200,
      text: '这是怎么吃呀？这种先炖的是直接打开就可以吃的，很方便。',
      words: [
        { startMs: 0, endMs: 500, text: '这是怎么吃呀', punctuation: '？' },
        { startMs: 700, endMs: 1_000, text: '这种', punctuation: '' },
        { startMs: 1_000, endMs: 2_200, text: '先炖的是直接打开就可以吃的', punctuation: '。' },
      ],
    };
    const before = structuredClone(segment);

    const findings = detectSpeakerReviewCandidates([segment]);

    assert.deepEqual(segment, before);
    assert.ok(
      findings.some(
        (finding) =>
          finding.reasonCode === 'question_answer_transition' &&
          finding.sourceSegmentIndex === 0 &&
          finding.splitAfterWordIndex === 0,
      ),
    );
    assert.ok(findings.some((finding) => finding.reasonCode === 'single_speaker_recording'));
  });
});
