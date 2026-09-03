/**
 * DashScope 双模式异步转写 Worker 测试。
 *
 * 验证提交释放、Polling 调度、统一终态发布、时间轴恢复和超时失败。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioTranscriptionProviderError } from '../../../dist/workspace/audio/transcription/errors.js';
import { AudioTranscriptionWorker } from '../../../dist/workspace/audio/transcription/worker.js';

function job(overrides = {}) {
  return {
    audioFileId: '40000000-0000-4000-8000-000000000001',
    dataSource: null,
    durationMs: 45_000,
    ingestionRunId: null,
    mimeType: 'audio/mpeg',
    model: 'qwen-audio-3.0-asr-flash-filetrans',
    originalFilename: 'meeting.mp3',
    preprocessingManifest: null,
    preprocessingMode: 'whole_file',
    revisionId: '50000000-0000-4000-8000-000000000001',
    revisionNo: 2,
    sizeBytes: 1_024,
    provider: 'dashscope',
    providerArtifactKey: null,
    providerLastPolledAt: null,
    providerNextPollAt: null,
    providerPollAttempt: 0,
    providerSubmittedAt: null,
    providerTaskId: null,
    providerTerminalErrorCode: null,
    providerTerminalErrorMessage: null,
    providerTerminalEventId: null,
    providerTerminalReceivedAt: null,
    providerTerminalResultUrl: null,
    providerTerminalSource: null,
    providerTerminalStatus: null,
    segmentationMode: 'speaker_turn',
    storageKey: 'meeting.mp3',
    title: '客户访谈',
    ...overrides,
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('worker did not reach the expected state');
}

describe('AudioTranscriptionWorker', () => {
  it('submits once, marks awaiting_result and does not query in EventBridge mode', async () => {
    const current = job();
    const calls = [];
    let claimed = false;
    const worker = new AudioTranscriptionWorker({
      maxInFlight: 3,
      notifyMode: 'eventbridge',
      repository: {
        resetInterruptedTranscriptions: async () => undefined,
        claimTerminalCompletion: async () => undefined,
        claimExpiredTranscription: async () => undefined,
        claimTranscription: async (limit) => {
          calls.push(['claim', limit]);
          if (claimed) return undefined;
          claimed = true;
          return current;
        },
        updateActivity: async (_job, activity) => calls.push(['activity', activity.stage]),
        recordPreprocessing: async () => calls.push(['record-preprocessing']),
        recordProviderArtifact: async () => calls.push(['record-artifact']),
        recordProviderTask: async (_job, taskId, _submittedAt, mode) =>
          calls.push(['record-task', taskId, mode]),
        failTranscription: async () => assert.fail('must not fail'),
      },
      preprocessor: {
        createWholeFile: async () => ({ path: 'prepared.mp3', manifest: null }),
        cleanup: async () => calls.push(['cleanup-local']),
      },
      dashScope: {
        submit: async () => {
          calls.push(['submit']);
          return 'task-1';
        },
        fetchResult: async () => assert.fail('must not fetch before callback'),
        queryTask: async () => assert.fail('must not query task status'),
      },
      ossStaging: {
        upload: async () => 'echowave/asr-staging/revision/audio.mp3',
        signedGetUrl: () => 'https://oss.example.com/audio.mp3',
        delete: async () => assert.fail('must retain artifact while awaiting callback'),
      },
    });

    await worker.start();
    await waitFor(() =>
      calls.some(([name, stage]) => name === 'activity' && stage === 'awaiting_result'),
    );
    await worker.stop();

    assert.ok(calls.some(([name, limit]) => name === 'claim' && limit === 3));
    assert.ok(calls.some(([name]) => name === 'submit'));
    assert.ok(
      calls.some(
        ([name, taskId, mode]) =>
          name === 'record-task' && taskId === 'task-1' && mode === 'eventbridge',
      ),
    );
    assert.equal(
      calls.some(([name]) => name === 'cleanup-local'),
      false,
    );
  });

  it('polls once per claim and persists the 2/5/10/15 second schedule', async () => {
    const delays = [];
    const resetModes = [];
    let claims = 0;
    const worker = new AudioTranscriptionWorker({
      maxInFlight: 1,
      notifyMode: 'polling',
      repository: {
        resetInterruptedTranscriptions: async (mode) => resetModes.push(mode),
        claimTerminalCompletion: async () => undefined,
        claimExpiredTranscription: async () => undefined,
        claimPollingDiscovery: async () => {
          if (claims >= 5) return undefined;
          const current = job({
            providerPollAttempt: claims,
            providerSubmittedAt: new Date(),
            providerTaskId: 'task-1',
          });
          claims += 1;
          return current;
        },
        claimTranscription: async () => undefined,
        scheduleNextPoll: async (_job, _attempt, delayMs) => delays.push(delayMs),
      },
      preprocessor: { cleanup: async () => undefined },
      dashScope: {
        submit: async () => assert.fail('must not submit'),
        fetchResult: async () => assert.fail('must not fetch before terminal state'),
        queryTask: async () => ({
          taskId: 'task-1',
          status: 'RUNNING',
          resultUrl: null,
          errorCode: null,
          errorMessage: null,
        }),
      },
    });

    await worker.start();
    await waitFor(() => delays.length === 5);
    await worker.stop();
    assert.deepEqual(resetModes, ['polling']);
    assert.deepEqual(delays, [2_000, 5_000, 10_000, 15_000, 15_000]);
  });

  it('reschedules a transient Polling query failure without failing the revision', async () => {
    let claimed = false;
    let scheduled;
    const worker = new AudioTranscriptionWorker({
      maxInFlight: 1,
      notifyMode: 'polling',
      repository: {
        resetInterruptedTranscriptions: async () => undefined,
        claimTerminalCompletion: async () => undefined,
        claimExpiredTranscription: async () => undefined,
        claimPollingDiscovery: async () => {
          if (claimed) return undefined;
          claimed = true;
          return job({ providerSubmittedAt: new Date(), providerTaskId: 'task-1' });
        },
        claimTranscription: async () => undefined,
        scheduleNextPoll: async (_job, attempt, delayMs) => {
          scheduled = { attempt, delayMs };
        },
        failTranscription: async () => assert.fail('transient polling errors must not fail'),
      },
      preprocessor: { cleanup: async () => undefined },
      dashScope: {
        submit: async () => assert.fail('must not submit'),
        fetchResult: async () => assert.fail('must not fetch before terminal state'),
        queryTask: async () => {
          throw new AudioTranscriptionProviderError(
            'MODEL_UNAVAILABLE',
            'DashScope task status request failed.',
            true,
            503,
          );
        },
      },
    });

    await worker.start();
    await waitFor(() => scheduled !== undefined);
    await worker.stop();
    assert.deepEqual(scheduled, { attempt: 1, delayMs: 2_000 });
  });

  it('normalizes a successful Polling discovery into the shared terminal handler', async () => {
    let claimed = false;
    let terminal;
    const worker = new AudioTranscriptionWorker({
      maxInFlight: 1,
      notifyMode: 'polling',
      repository: {
        resetInterruptedTranscriptions: async () => undefined,
        claimTerminalCompletion: async () => undefined,
        claimExpiredTranscription: async () => undefined,
        claimPollingDiscovery: async () => {
          if (claimed) return undefined;
          claimed = true;
          return job({ providerSubmittedAt: new Date(), providerTaskId: 'task-1' });
        },
        claimTranscription: async () => undefined,
        recordProviderTerminal: async (input) => {
          terminal = input;
          return undefined;
        },
      },
      preprocessor: { cleanup: async () => undefined },
      dashScope: {
        submit: async () => assert.fail('must not submit'),
        fetchResult: async () => assert.fail('must not fetch inside discovery'),
        queryTask: async () => ({
          taskId: 'task-1',
          status: 'SUCCEEDED',
          resultUrl: 'https://result.example.com/transcription.json',
          errorCode: null,
          errorMessage: null,
        }),
      },
    });

    await worker.start();
    await waitFor(() => terminal !== undefined);
    await worker.stop();
    assert.deepEqual(
      { ...terminal, receivedAt: undefined },
      {
        source: 'polling',
        eventId: null,
        taskId: 'task-1',
        status: 'SUCCEEDED',
        receivedAt: undefined,
        resultUrl: 'https://result.example.com/transcription.json',
        errorCode: null,
        errorMessage: null,
      },
    );
    assert.ok(terminal.receivedAt instanceof Date);
  });

  it('downloads a successful terminal result, restores VAD time and publishes it', async () => {
    const manifest = {
      version: 1,
      mode: 'silero_vad',
      model: 'silero-vad-v6.2.1',
      modelSha256: '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3',
      originalDurationMs: 100_000,
      processedDurationMs: 12_000,
      skippedDurationMs: 88_000,
      policy: {
        sampleRate: 16_000,
        frameSamples: 512,
        startThreshold: 0.5,
        endThreshold: 0.35,
        minSpeechMs: 250,
        minSilenceMs: 100,
        speechPrePadMs: 400,
        speechPostPadMs: 600,
        collapseGapOverMs: 30_000,
        separatorMs: 2_000,
      },
      sourceSpans: [
        {
          originalStartMs: 40_000,
          originalEndMs: 52_000,
          processedStartMs: 0,
          processedEndMs: 12_000,
        },
      ],
      skippedIntervals: [
        { startMs: 0, endMs: 40_000, reason: 'silero_vad_non_speech' },
        { startMs: 52_000, endMs: 100_000, reason: 'silero_vad_non_speech' },
      ],
    };
    const current = job({
      durationMs: 100_000,
      preprocessingManifest: manifest,
      preprocessingMode: 'silero_vad',
      providerArtifactKey: 'echowave/asr-staging/revision/audio.mp3',
      providerTerminalEventId: 'event-1',
      providerTerminalReceivedAt: new Date(),
      providerTerminalResultUrl: 'https://result.example.com/transcription.json',
      providerTerminalSource: 'eventbridge',
      providerTerminalStatus: 'SUCCEEDED',
      providerSubmittedAt: new Date(),
      providerTaskId: 'task-1',
    });
    let claimed = false;
    let published;
    const calls = [];
    const worker = new AudioTranscriptionWorker({
      maxInFlight: 1,
      notifyMode: 'eventbridge',
      repository: {
        resetInterruptedTranscriptions: async () => undefined,
        claimTerminalCompletion: async () => {
          if (claimed) return undefined;
          claimed = true;
          return current;
        },
        claimExpiredTranscription: async () => undefined,
        claimTranscription: async () => undefined,
        updateActivity: async () => undefined,
        publishTranscription: async (_job, segments) => {
          published = segments;
        },
        clearProviderArtifact: async () => calls.push('clear-artifact'),
        failTranscription: async () => assert.fail('must not fail'),
      },
      preprocessor: { cleanup: async () => calls.push('cleanup-local') },
      dashScope: {
        submit: async () => assert.fail('must not submit'),
        fetchResult: async (taskId, resultUrl, context) => {
          assert.equal(taskId, 'task-1');
          assert.equal(resultUrl, current.providerTerminalResultUrl);
          assert.equal(context.durationMs, 12_000);
          return {
            taskId,
            segments: [
              {
                speakerKey: 'Speaker 0',
                businessRole: 'unknown',
                emotion: 'unknown',
                startMs: 100,
                endMs: 900,
                text: '恢复成功',
                words: [{ startMs: 200, endMs: 400, text: '恢复成功', punctuation: '' }],
              },
            ],
          };
        },
      },
      ossStaging: { delete: async () => calls.push('delete-artifact') },
    });

    await worker.start();
    await waitFor(() => published !== undefined);
    await worker.stop();

    assert.deepEqual(
      published.map(({ startMs, endMs }) => ({ startMs, endMs })),
      [{ startMs: 40_100, endMs: 40_900 }],
    );
    assert.deepEqual(calls, ['delete-artifact', 'clear-artifact', 'cleanup-local']);
  });

  it('fails a successful terminal result without a URL as invalid model output', async () => {
    const current = job({
      providerTerminalEventId: 'event-1',
      providerTerminalReceivedAt: new Date(),
      providerTerminalSource: 'eventbridge',
      providerTerminalStatus: 'SUCCEEDED',
      providerSubmittedAt: new Date(),
      providerTaskId: 'task-1',
    });
    let claimed = false;
    let failure;
    const worker = new AudioTranscriptionWorker({
      maxInFlight: 1,
      notifyMode: 'eventbridge',
      repository: {
        resetInterruptedTranscriptions: async () => undefined,
        claimTerminalCompletion: async () => {
          if (claimed) return undefined;
          claimed = true;
          return current;
        },
        claimExpiredTranscription: async () => undefined,
        claimTranscription: async () => undefined,
        failTranscription: async (_job, code) => {
          failure = code;
        },
      },
      preprocessor: { cleanup: async () => undefined },
      dashScope: {
        submit: async () => assert.fail('must not submit'),
        fetchResult: async () => assert.fail('must not fetch'),
      },
    });

    await worker.start();
    await waitFor(() => failure !== undefined);
    await worker.stop();
    assert.equal(failure, 'INVALID_MODEL_OUTPUT');
  });

  it('fails an expired task without fetching or querying DashScope', async () => {
    const current = job({
      providerArtifactKey: 'echowave/asr-staging/revision/audio.mp3',
      providerSubmittedAt: new Date('2026-08-28T00:00:00.000Z'),
      providerTaskId: 'task-old',
    });
    let claimed = false;
    let failure;
    const worker = new AudioTranscriptionWorker({
      maxInFlight: 1,
      notifyMode: 'eventbridge',
      repository: {
        resetInterruptedTranscriptions: async () => undefined,
        claimTerminalCompletion: async () => undefined,
        claimExpiredTranscription: async () => {
          if (claimed) return undefined;
          claimed = true;
          return current;
        },
        claimTranscription: async () => undefined,
        failTranscription: async (_job, code) => {
          failure = code;
        },
        clearProviderArtifact: async () => undefined,
      },
      preprocessor: { cleanup: async () => undefined },
      dashScope: {
        submit: async () => assert.fail('must not submit'),
        fetchResult: async () => assert.fail('must not fetch'),
      },
      ossStaging: { delete: async () => undefined },
    });

    await worker.start();
    await waitFor(() => failure !== undefined);
    await worker.stop();
    assert.equal(failure, 'MODEL_TIMEOUT');
  });
});
