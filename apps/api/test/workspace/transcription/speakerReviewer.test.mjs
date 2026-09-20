/**
 * 说话人复核适配器测试。
 *
 * 锁定模型只能引用输入中真实存在的原始片段与词边界，以及按绑定供应商选择思考参数。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SpeakerReviewer } from '../../../dist/workspace/audio/speaker-review/speakerReviewer.js';

const segmentId = '33333333-3333-4333-8333-333333333333';
const segments = [
  {
    id: segmentId,
    speakerKey: 'Speaker 0',
    words: [
      { index: 0, startMs: 0, endMs: 400, text: '这是怎么吃呀', punctuation: '？' },
      { index: 1, startMs: 500, endMs: 900, text: '这种', punctuation: '' },
    ],
    candidateBoundaries: [0],
  },
];

function reviewerWith(findings, { providerType = 'deepseek', requests } = {}) {
  return new SpeakerReviewer({
    providerType,
    apiKey: 'secret',
    baseUrl:
      providerType === 'deepseek'
        ? 'https://api.deepseek.example/v1'
        : 'https://dashscope.example/compatible-mode/v1',
    model: providerType === 'deepseek' ? 'deepseek-v4-flash' : 'qwen3.5-omni-flash',
    fetch: async (_url, init) => {
      requests?.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings }) } }] }),
        { status: 200 },
      );
    },
    sleep: async () => undefined,
  });
}

describe('SpeakerReviewer', () => {
  it('accepts a real boundary and rejects fabricated segments or indexes', async () => {
    const valid = await reviewerWith([
      {
        segmentId,
        splitAfterWordIndex: 0,
        severity: 'high',
        reasonCode: 'question_answer_transition',
        explanation: '问答语气出现切换。',
      },
    ]).review(segments);
    assert.equal(valid[0].segmentId, segmentId);

    await assert.rejects(
      () =>
        reviewerWith([
          {
            segmentId: '44444444-4444-4444-8444-444444444444',
            splitAfterWordIndex: 0,
            severity: 'medium',
            reasonCode: 'dialogue_pattern',
            explanation: '虚构片段。',
          },
        ]).review(segments),
      { code: 'INVALID_MODEL_OUTPUT' },
    );
    await assert.rejects(
      () =>
        reviewerWith([
          {
            segmentId,
            splitAfterWordIndex: 1,
            severity: 'medium',
            reasonCode: 'long_internal_pause',
            explanation: '不存在的末尾边界。',
          },
        ]).review(segments),
      { code: 'INVALID_MODEL_OUTPUT' },
    );
    await assert.rejects(
      () =>
        reviewerWith([
          {
            segmentId,
            splitAfterWordIndex: 0,
            speakerKey: 'Speaker 99',
            severity: 'medium',
            reasonCode: 'dialogue_pattern',
            explanation: '模型不得指定 Speaker。',
          },
        ]).review(segments),
      { code: 'INVALID_MODEL_OUTPUT' },
    );
  });

  it('sends the Qwen-compatible thinking flag on DashScope bindings', async () => {
    const requests = [];
    await reviewerWith([], { providerType: 'dashscope', requests }).review(segments);
    assert.equal(requests[0].enable_thinking, false);
    assert.equal('thinking' in requests[0], false);
    assert.equal(requests[0].model, 'qwen3.5-omni-flash');
  });
});
