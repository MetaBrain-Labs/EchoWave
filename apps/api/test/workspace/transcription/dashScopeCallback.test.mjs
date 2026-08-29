/**
 * DashScope EventBridge 完成事件服务测试。
 *
 * 覆盖成功、失败、结构拒绝和未知任务的快速持久化行为。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DashScopeCallbackError,
  DashScopeCallbackService,
} from '../../../dist/workspace/transcription/dashScopeCallback.js';

function callback(overrides = {}) {
  return {
    specversion: '1.0',
    id: 'event-1',
    source: 'acs.dashscope',
    type: 'dashscope:System:AsyncTaskFinish',
    aliyunregionid: 'cn-beijing',
    data: {
      task_id: 'task-1',
      task_status: 'SUCCEEDED',
      region: 'cn-beijing',
      contain_result: true,
      user_api_unique_key: 'apikey:v1:audio:asr:transcription:qwen-audio-3.0-asr-flash-filetrans',
      output_result: {
        output: {
          task_id: 'task-1',
          task_status: 'SUCCEEDED',
          results: [
            {
              subtask_status: 'SUCCEEDED',
              transcription_url: 'https://result.example.com/transcription.json',
            },
          ],
        },
      },
      ...overrides,
    },
  };
}

function service(recordProviderTerminal) {
  const reports = [];
  return {
    reports,
    service: new DashScopeCallbackService({
      signatureVerifier: { verify: async () => undefined },
      repository: { recordProviderTerminal },
      rawResponseReporter: { record: async (input) => reports.push(input) },
    }),
  };
}

describe('DashScopeCallbackService', () => {
  it('persists the success URL and records the callback without querying task status', async () => {
    const callbacks = [];
    const fixture = service(async (input) => {
      callbacks.push(input);
      return { revisionId: 'revision-1', durationMs: 1_000, preprocessing: 'whole_file' };
    });
    assert.equal(
      await fixture.service.receive(JSON.stringify(callback()), new Headers()),
      'accepted',
    );
    assert.deepEqual(
      { ...callbacks[0], receivedAt: undefined },
      {
        source: 'eventbridge',
        eventId: 'event-1',
        taskId: 'task-1',
        status: 'SUCCEEDED',
        receivedAt: undefined,
        resultUrl: 'https://result.example.com/transcription.json',
        errorCode: null,
        errorMessage: null,
      },
    );
    assert.ok(callbacks[0].receivedAt instanceof Date);
    assert.equal(fixture.reports[0].responseKind, 'task_callback');
  });

  it('persists provider failures and safely ignores unknown or duplicate tasks', async () => {
    const callbacks = [];
    const fixture = service(async (input) => {
      callbacks.push(input);
      return undefined;
    });
    const failed = callback({
      task_status: 'FAILED',
      output_result: {
        output: {
          task_id: 'task-1',
          task_status: 'FAILED',
          code: 'ProviderError',
          message: 'provider failed',
        },
      },
    });
    assert.equal(await fixture.service.receive(JSON.stringify(failed), new Headers()), 'ignored');
    assert.equal(callbacks[0].status, 'FAILED');
    assert.equal(callbacks[0].resultUrl, null);
    assert.equal(fixture.reports.length, 0);
  });

  it('accepts canceled, unknown and successful callbacks without a result URL as terminal facts', async () => {
    const callbacks = [];
    const fixture = service(async (input) => {
      callbacks.push(input);
      return undefined;
    });
    for (const status of ['CANCELED', 'UNKNOWN']) {
      const terminal = callback({
        task_status: status,
        output_result: { output: { task_id: 'task-1', task_status: status } },
      });
      assert.equal(
        await fixture.service.receive(JSON.stringify(terminal), new Headers()),
        'ignored',
      );
    }
    const missingUrl = callback({
      output_result: {
        output: { task_id: 'task-1', task_status: 'SUCCEEDED', results: [] },
      },
    });
    assert.equal(
      await fixture.service.receive(JSON.stringify(missingUrl), new Headers()),
      'ignored',
    );
    assert.deepEqual(
      callbacks.map(({ status, resultUrl }) => ({ status, resultUrl })),
      [
        { status: 'CANCELED', resultUrl: null },
        { status: 'UNKNOWN', resultUrl: null },
        { status: 'SUCCEEDED', resultUrl: null },
      ],
    );
  });

  it('rejects malformed JSON, model mismatches and task ID mismatches', async () => {
    const fixture = service(async () => assert.fail('must not persist'));
    await assert.rejects(() => fixture.service.receive('{', new Headers()), {
      kind: 'bad_request',
    });
    const wrongModel = callback({ user_api_unique_key: 'apikey:v1:audio:asr:other-model' });
    await assert.rejects(
      () => fixture.service.receive(JSON.stringify(wrongModel), new Headers()),
      (error) => error instanceof DashScopeCallbackError && error.kind === 'bad_request',
    );
    const wrongTask = callback({
      output_result: { output: { task_id: 'task-2', results: [] } },
    });
    await assert.rejects(() => fixture.service.receive(JSON.stringify(wrongTask), new Headers()), {
      kind: 'bad_request',
    });
    const wrongStatus = callback({
      output_result: { output: { task_id: 'task-1', task_status: 'FAILED' } },
    });
    await assert.rejects(
      () => fixture.service.receive(JSON.stringify(wrongStatus), new Headers()),
      { kind: 'bad_request' },
    );
    const insecureUrl = callback({
      output_result: {
        output: {
          task_id: 'task-1',
          task_status: 'SUCCEEDED',
          results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'http://localhost/result' }],
        },
      },
    });
    await assert.rejects(
      () => fixture.service.receive(JSON.stringify(insecureUrl), new Headers()),
      { kind: 'bad_request' },
    );
  });
});
