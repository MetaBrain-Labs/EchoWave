/**
 * DashScope 文件转写适配器测试。
 *
 * 锁定中文说话轮次边界、严格输出校验与异步任务退避行为。
 *
 * Responsibilities:
 * - 防止 Speaker 或时间戳异常被静默转换为普通段落。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DashScopeFileTranscription,
  normalizeSpeakerTurnSegments,
} from '../../../dist/workspace/audio/transcription/dashScopeFileTranscription.js';

function result(sentences) {
  return { transcripts: [{ sentences }] };
}

function sentence(begin_time, end_time, text, speaker_id = 0, words = []) {
  return { begin_time, end_time, text, speaker_id, words };
}

describe('normalizeSpeakerTurnSegments', () => {
  it('starts a paragraph whenever the speaker changes', () => {
    const segments = normalizeSpeakerTurnSegments(
      result([
        sentence(0, 800, '您好。', 'customer'),
        sentence(900, 1_500, '您好，请问需要什么？', 'staff'),
        sentence(1_600, 2_000, '我先了解一下。', 'customer'),
      ]),
    );
    assert.deepEqual(
      segments.map(({ speakerKey, text }) => ({ speakerKey, text })),
      [
        { speakerKey: 'Speaker 0', text: '您好。' },
        { speakerKey: 'Speaker 1', text: '您好，请问需要什么？' },
        { speakerKey: 'Speaker 0', text: '我先了解一下。' },
      ],
    );
  });

  it('merges a short same-speaker pause but splits at 1500ms', () => {
    const segments = normalizeSpeakerTurnSegments(
      result([
        sentence(0, 500, '第一句。'),
        sentence(1_999, 2_500, '第二句。'),
        sentence(4_000, 4_500, '第三句。'),
      ]),
    );
    assert.equal(segments.length, 2);
    assert.equal(segments[0].text, '第一句。第二句。');
    assert.equal(segments[1].text, '第三句。');
  });

  it('uses 240 characters as a soft merge limit without splitting a provider sentence', () => {
    const longSentence = '长'.repeat(250);
    const segments = normalizeSpeakerTurnSegments(
      result([
        sentence(0, 500, '短'.repeat(238)),
        sentence(600, 1_000, '补充内容'),
        sentence(1_100, 2_000, longSentence),
      ]),
    );
    assert.equal(segments.length, 3);
    assert.equal(segments[2].text.length, 250);
  });

  it('keeps ordered word timestamps when provider sentences merge', () => {
    const segments = normalizeSpeakerTurnSegments(
      result([
        sentence(0, 500, '这是怎么吃呀？', 0, [
          { begin_time: 0, end_time: 500, text: '这是怎么吃呀', punctuation: '？' },
        ]),
        sentence(600, 1_200, '这种打开就可以吃。', 0, [
          { begin_time: 600, end_time: 1_200, text: '这种打开就可以吃', punctuation: '。' },
        ]),
      ]),
    );
    assert.equal(segments.length, 1);
    assert.deepEqual(segments[0].words, [
      { startMs: 0, endMs: 500, text: '这是怎么吃呀', punctuation: '？' },
      { startMs: 600, endMs: 1_200, text: '这种打开就可以吃', punctuation: '。' },
    ]);
    assert.throws(
      () =>
        normalizeSpeakerTurnSegments(
          result([
            sentence(0, 500, '异常', 0, [
              { begin_time: 400, end_time: 600, text: '越界', punctuation: '' },
            ]),
          ]),
        ),
      { code: 'INVALID_MODEL_OUTPUT' },
    );
  });

  it('rejects missing Speaker, invalid timestamps, overlap and empty audio', () => {
    assert.throws(
      () =>
        normalizeSpeakerTurnSegments({
          transcripts: [{ sentences: [{ begin_time: 0, end_time: 100, text: '缺失' }] }],
        }),
      { code: 'INVALID_MODEL_OUTPUT' },
    );
    assert.throws(() => normalizeSpeakerTurnSegments(result([sentence(100, 100, '无效')])), {
      code: 'INVALID_MODEL_OUTPUT',
    });
    assert.throws(() => normalizeSpeakerTurnSegments(result([sentence(0, 1_001, '越界')]), 1_000), {
      code: 'INVALID_MODEL_OUTPUT',
    });
    assert.throws(
      () =>
        normalizeSpeakerTurnSegments(
          result([sentence(0, 500, '第一句'), sentence(400, 800, '重叠')]),
        ),
      { code: 'INVALID_MODEL_OUTPUT' },
    );
    assert.throws(() => normalizeSpeakerTurnSegments(result([])), {
      code: 'INVALID_MODEL_OUTPUT',
    });
  });
});

describe('DashScopeFileTranscription', () => {
  it('submits diarization and downloads the callback result without querying task status', async () => {
    const requests = [];
    const delays = [];
    const rawReports = [];
    const responses = [{ output: { task_id: 'task-1' } }, result([sentence(0, 500, '你好')])];
    const fetchImpl = async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const adapter = new DashScopeFileTranscription(
      'secret',
      'https://workspace.example.com/api/v1',
      fetchImpl,
      async (delay) => delays.push(delay),
      { record: async (input) => rawReports.push(input) },
    );
    const context = { revisionId: 'revision-1', durationMs: 500 };
    const taskId = await adapter.submit('https://oss.example/audio.mp3', context);
    const completed = await adapter.fetchResult(
      taskId,
      'https://result.example/transcript.json',
      context,
    );
    const submittedBody = JSON.parse(requests[0].init.body);
    assert.equal(submittedBody.parameters.diarization_enabled, true);
    assert.deepEqual(submittedBody.parameters.language_hints, ['zh']);
    assert.equal('speaker_count' in submittedBody.parameters, false);
    assert.deepEqual(submittedBody.input.file_urls, ['https://oss.example/audio.mp3']);
    assert.deepEqual(delays, []);
    assert.equal(
      requests.some(({ url }) => url.includes('/tasks/')),
      false,
    );
    assert.equal(completed.segments[0].speakerKey, 'Speaker 0');
    assert.equal(rawReports[0].provider, 'dashscope');
    assert.equal(rawReports[0].responseKind, 'task_submission');
    assert.equal(rawReports.at(-1).responseKind, 'transcription_result');
    assert.match(rawReports.at(-1).rawResponseText, /"speaker_id":0/);
  });

  it('sends speaker_count only when an expected count is provided', async () => {
    const requests = [];
    const adapter = new DashScopeFileTranscription(
      'secret',
      'https://workspace.example.com/api/v1',
      async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify({ output: { task_id: 'task-2' } }), { status: 200 });
      },
      async () => undefined,
    );
    await adapter.submit('https://oss.example/audio.mp3', undefined, 3);
    const submittedBody = JSON.parse(requests[0].init.body);
    assert.equal(submittedBody.parameters.speaker_count, 3);
  });

  it('maps the frozen English analysis language to the provider hint', async () => {
    const requests = [];
    const adapter = new DashScopeFileTranscription(
      'secret',
      'https://workspace.example.com/api/v1',
      async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify({ output: { task_id: 'task-en' } }), { status: 200 });
      },
      async () => undefined,
    );

    await adapter.submit('https://oss.example/audio.mp3', undefined, undefined, 'en');

    assert.deepEqual(JSON.parse(requests[0].init.body).parameters.language_hints, ['en']);
  });

  it('enables DashScope resolution for temporary oss URLs', async () => {
    let request;
    const adapter = new DashScopeFileTranscription(
      'secret',
      'https://workspace.example.com/api/v1',
      async (url, init) => {
        request = { url, init };
        return new Response(JSON.stringify({ output: { task_id: 'task-oss' } }), { status: 200 });
      },
      async () => undefined,
    );
    await adapter.submit('oss://temporary-bucket/audio.mp3');
    assert.equal(request.init.headers['X-DashScope-OssResourceResolve'], 'enable');
  });

  it('performs exactly one task-status request and normalizes non-terminal and terminal states', async () => {
    const requests = [];
    const rawReports = [];
    const responses = [
      { output: { task_id: 'task-1', task_status: 'RUNNING' } },
      {
        output: {
          task_id: 'task-1',
          task_status: 'SUCCEEDED',
          results: [{ transcription_url: 'https://result.example/transcript.json' }],
        },
      },
      {
        output: {
          task_id: 'task-1',
          task_status: 'CANCELED',
          code: 'CanceledByUser',
          message: 'canceled',
        },
      },
    ];
    const adapter = new DashScopeFileTranscription(
      'secret',
      'https://workspace.example.com/api/v1',
      async (url) => {
        requests.push(url);
        return new Response(JSON.stringify(responses.shift()), { status: 200 });
      },
      async () => undefined,
      { record: async (input) => rawReports.push(input) },
    );
    const context = { revisionId: 'revision-1', durationMs: 500 };

    assert.equal((await adapter.queryTask('task-1', 1, context)).status, 'RUNNING');
    assert.equal(
      (await adapter.queryTask('task-1', 2, context)).resultUrl,
      'https://result.example/transcript.json',
    );
    const canceled = await adapter.queryTask('task-1', 3, context);
    assert.equal(canceled.status, 'CANCELED');
    assert.equal(canceled.errorCode, 'CanceledByUser');
    assert.equal(requests.length, 3);
    assert.ok(requests.every((url) => url.endsWith('/tasks/task-1')));
    assert.ok(rawReports.every((report) => report.responseKind === 'task_status'));
  });

  it('marks only 429 and 5xx polling failures as retryable', async () => {
    for (const [status, retryable] of [
      [400, false],
      [429, true],
      [503, true],
    ]) {
      const adapter = new DashScopeFileTranscription(
        'secret',
        'https://workspace.example.com/api/v1',
        async () => new Response('unavailable', { status }),
        async () => undefined,
      );
      await assert.rejects(() => adapter.queryTask('task-1', 1), { retryable });
    }
  });

  it('retries temporary result download failures at most three times', async () => {
    const delays = [];
    let attempts = 0;
    const adapter = new DashScopeFileTranscription(
      'secret',
      'https://workspace.example.com/api/v1',
      async () => {
        attempts += 1;
        return attempts < 3
          ? new Response('unavailable', { status: 503 })
          : new Response(JSON.stringify(result([sentence(0, 500, '恢复成功')])), {
              status: 200,
            });
      },
      async (delay) => delays.push(delay),
    );
    const completed = await adapter.fetchResult('task-1', 'https://result.example/result.json');
    assert.equal(completed.segments[0].text, '恢复成功');
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1_000, 2_000]);
  });

  it('does not retry invalid result structures', async () => {
    let attempts = 0;
    const adapter = new DashScopeFileTranscription(
      'secret',
      'https://workspace.example.com/api/v1',
      async () => {
        attempts += 1;
        return new Response('{}', { status: 200 });
      },
      async () => undefined,
    );
    await assert.rejects(
      () => adapter.fetchResult('task-1', 'https://result.example/result.json'),
      {
        code: 'INVALID_MODEL_OUTPUT',
      },
    );
    assert.equal(attempts, 1);
  });
});
