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
} from '../../../dist/workspace/transcription/dashScopeFileTranscription.js';

function result(sentences) {
  return { transcripts: [{ sentences }] };
}

function sentence(begin_time, end_time, text, speaker_id = 0) {
  return { begin_time, end_time, text, speaker_id };
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
  it('submits diarization and polls with 2/5/10/15 second backoff', async () => {
    const requests = [];
    const delays = [];
    const rawReports = [];
    const responses = [
      { output: { task_id: 'task-1' } },
      { output: { task_status: 'PENDING' } },
      { output: { task_status: 'RUNNING' } },
      { output: { task_status: 'RUNNING' } },
      { output: { task_status: 'RUNNING' } },
      {
        output: {
          task_status: 'SUCCEEDED',
          results: [{ transcription_url: 'https://result.example/transcript.json' }],
        },
      },
      result([sentence(0, 500, '你好')]),
    ];
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
      () => Date.parse('2026-08-26T00:00:00.000Z'),
      { record: async (input) => rawReports.push(input) },
    );
    const context = { revisionId: 'revision-1', durationMs: 500 };
    const taskId = await adapter.submit('https://oss.example/audio.mp3', context);
    const completed = await adapter.waitForResult(
      taskId,
      new Date('2026-08-26T00:00:00.000Z'),
      context,
    );
    const submittedBody = JSON.parse(requests[0].init.body);
    assert.equal(submittedBody.parameters.diarization_enabled, true);
    assert.deepEqual(submittedBody.input.file_urls, ['https://oss.example/audio.mp3']);
    assert.deepEqual(delays, [2_000, 5_000, 10_000, 15_000]);
    assert.equal(completed.segments[0].speakerKey, 'Speaker 0');
    assert.equal(rawReports[0].provider, 'dashscope');
    assert.equal(rawReports[0].responseKind, 'task_submission');
    assert.equal(rawReports.at(-1).responseKind, 'transcription_result');
    assert.match(rawReports.at(-1).rawResponseText, /"speaker_id":0/);
  });

  it('maps provider failure to a retryable stable error', async () => {
    const adapter = new DashScopeFileTranscription(
      'secret',
      'https://workspace.example.com/api/v1',
      async () =>
        new Response(
          JSON.stringify({ output: { task_status: 'FAILED', message: 'quota unavailable' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      async () => undefined,
      () => Date.parse('2026-08-26T00:00:00.000Z'),
    );
    await assert.rejects(
      () => adapter.waitForResult('task-1', new Date('2026-08-26T00:00:00.000Z')),
      { code: 'MODEL_UNAVAILABLE', retryable: true },
    );
  });

  it('fails a resumed task after the six-hour deadline without polling again', async () => {
    let requests = 0;
    const submittedAt = new Date('2026-08-26T00:00:00.000Z');
    const adapter = new DashScopeFileTranscription(
      'secret',
      'https://workspace.example.com/api/v1',
      async () => {
        requests += 1;
        return new Response('{}', { status: 200 });
      },
      async () => undefined,
      () => submittedAt.getTime() + 6 * 60 * 60 * 1_000,
    );
    await assert.rejects(() => adapter.waitForResult('task-old', submittedAt), {
      code: 'MODEL_TIMEOUT',
      retryable: true,
    });
    assert.equal(requests, 0);
  });
});
