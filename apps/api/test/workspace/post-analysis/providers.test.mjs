/**
 * 音频后置分析 Provider 契约测试。
 *
 * 验证模型文本恢复、结构纠正、ID 完整性和角色白名单边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DeepSeekRoleRecognizer } from '../../../dist/workspace/audio/post-analysis/deepSeekRoleRecognizer.js';
import { QwenEmotionAnalyzer } from '../../../dist/workspace/audio/post-analysis/qwenEmotionAnalyzer.js';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const segments = [
  {
    id: firstId,
    speakerKey: 'Speaker 0',
    startMs: 0,
    endMs: 1_000,
    relativeStartMs: 0,
    relativeEndMs: 1_000,
    text: '您好。',
  },
  {
    id: secondId,
    speakerKey: 'Speaker 1',
    startMs: 1_000,
    endMs: 2_000,
    relativeStartMs: 1_000,
    relativeEndMs: 2_000,
    text: '价格是多少？',
  },
];

const emotion = (segmentId) => ({
  segmentId,
  label: 'neutral',
  confidence: 0.8,
  attitude: 'neutral',
  arousal: 'medium',
  pace: 'normal',
  volumeTrend: 'normal',
  pitchVariation: 'medium',
  pausePattern: 'normal',
  vocalCues: [],
});

function response(content, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function recorder(modelCalls) {
  return {
    recordMetadata: () => {},
    recordStep: () => {},
    recordModelCall: (event) => modelCalls.push(event),
    recordToolCall: () => {},
    recordContext: () => {},
    recordReasoning: () => {},
    recordOutput: () => {},
    finish: async () => {},
  };
}

describe('post-analysis providers', () => {
  it('corrects fenced Qwen output and returns every target exactly once', async () => {
    const calls = [];
    const modelCalls = [];
    const analyzer = new QwenEmotionAnalyzer({
      apiKey: 'test',
      baseUrl: 'https://example.test/v1',
      model: 'qwen3.5-omni-flash',
      sleep: async () => {},
      fetch: async (_url, init) => {
        calls.push(JSON.parse(init.body));
        return calls.length === 1
          ? response('```json\n{"segments":[]}\n```')
          : response(JSON.stringify({ segments: segments.map(({ id }) => emotion(id)) }));
      },
    });
    const result = await analyzer.analyze(
      'https://oss.test/window.mp3?Signature=private',
      segments,
      recorder(modelCalls),
    );
    assert.equal(calls.length, 2);
    assert.equal(modelCalls.length, 2);
    assert.deepEqual(
      modelCalls[0].input.messages.map(({ role }) => role),
      ['system', 'user'],
    );
    assert.equal(modelCalls[0].input.messages[1].content[0].input_audio.data, '[OMITTED_AUDIO]');
    assert.doesNotMatch(JSON.stringify(modelCalls), /private|oss\.test/);
    assert.match(modelCalls[1].output.content, /segments/);
    assert.deepEqual(
      result.map(({ segmentId }) => segmentId),
      [firstId, secondId],
    );
    assert.equal(result[0].model, 'qwen3.5-omni-flash');
  });

  it('rejects Qwen output with unknown segment IDs', async () => {
    const analyzer = new QwenEmotionAnalyzer({
      apiKey: 'test',
      baseUrl: 'https://example.test/v1',
      model: 'qwen3.5-omni-flash',
      sleep: async () => {},
      fetch: async () =>
        response(
          JSON.stringify({
            segments: [emotion(firstId), emotion('33333333-3333-4333-8333-333333333333')],
          }),
        ),
    });
    await assert.rejects(
      () => analyzer.analyze('https://oss.test/window.mp3', segments),
      /完整、可验证/,
    );
  });

  it('enables DashScope resolution for temporary acoustic windows', async () => {
    let headers;
    const analyzer = new QwenEmotionAnalyzer({
      apiKey: 'test',
      baseUrl: 'https://example.test/v1',
      model: 'qwen3.5-omni-flash',
      sleep: async () => {},
      fetch: async (_url, init) => {
        headers = init.headers;
        return response(JSON.stringify({ segments: segments.map(({ id }) => emotion(id)) }));
      },
    });
    await analyzer.analyze('oss://temporary-bucket/window.mp3', segments);
    assert.equal(headers['X-DashScope-OssResourceResolve'], 'enable');
  });

  it('recognizes only allowed roles and validates evidence ownership', async () => {
    const modelCalls = [];
    const recognizer = new DeepSeekRoleRecognizer({
      apiKey: 'test',
      baseUrl: 'https://api.deepseek.test',
      model: 'deepseek-v4-flash',
      sleep: async () => {},
      fetch: async () =>
        response(
          JSON.stringify({
            speakers: [
              {
                speakerKey: 'Speaker 0',
                role: '销售',
                confidence: 0.9,
                evidenceSegmentIds: [firstId],
              },
              {
                speakerKey: 'Speaker 1',
                role: '采购',
                confidence: 0.8,
                evidenceSegmentIds: [secondId],
              },
            ],
          }),
        ),
    });
    const result = await recognizer.recognize(segments, ['采购'], recorder(modelCalls));
    assert.equal(modelCalls.length, 1);
    assert.deepEqual(
      modelCalls[0].input.messages.map(({ role }) => role),
      ['user'],
    );
    assert.match(modelCalls[0].input.messages[0].content, /Transcript:/);
    assert.match(modelCalls[0].output.content, /speakers/);
    assert.deepEqual(
      result.map(({ kind }) => kind),
      ['sales', 'custom'],
    );
  });

  it('rejects roles outside the data-source whitelist', async () => {
    const recognizer = new DeepSeekRoleRecognizer({
      apiKey: 'test',
      baseUrl: 'https://api.deepseek.test',
      model: 'deepseek-v4-flash',
      sleep: async () => {},
      fetch: async () =>
        response(
          JSON.stringify({
            speakers: [
              {
                speakerKey: 'Speaker 0',
                role: '老板',
                confidence: 0.9,
                evidenceSegmentIds: [firstId],
              },
              {
                speakerKey: 'Speaker 1',
                role: '客户',
                confidence: 0.8,
                evidenceSegmentIds: [secondId],
              },
            ],
          }),
        ),
    });
    await assert.rejects(() => recognizer.recognize(segments, []), /完整、可验证/);
  });
});
