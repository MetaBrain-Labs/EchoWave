/**
 * DashScope 整文件转写 Worker 测试。
 *
 * 验证任务恢复、发布和 OSS 清理边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioTranscriptionWorker } from '../../../dist/workspace/transcription/worker.js';

describe('AudioTranscriptionWorker', () => {
  it('resumes an existing DashScope task without preprocessing, uploading, or submitting again', async () => {
    const job = {
      audioFileId: '40000000-0000-4000-8000-000000000001',
      dataSource: null,
      durationMs: 45_000,
      ingestionRunId: null,
      mimeType: 'audio/mpeg',
      model: 'qwen-audio-3.0-asr-flash-filetrans',
      originalFilename: 'meeting.mp3',
      preprocessingMode: 'whole_file',
      revisionId: '50000000-0000-4000-8000-000000000001',
      revisionNo: 2,
      sizeBytes: 1_024,
      provider: 'dashscope',
      providerArtifactKey: 'echowave/asr-staging/tenant/revision/audio.mp3',
      providerSubmittedAt: new Date('2026-08-26T00:00:00.000Z'),
      providerTaskId: 'task-existing',
      segmentationMode: 'speaker_turn',
      storageKey: 'meeting.mp3',
      title: '客户访谈',
    };
    let claimed = false;
    const calls = [];
    const repository = {
      resetInterruptedTranscriptions: async () => undefined,
      claimTranscription: async () => {
        if (claimed) return undefined;
        claimed = true;
        return job;
      },
      updateActivity: async (_job, activity) => calls.push(['activity', activity.stage]),
      publishTranscription: async (_job, segments, metadata) =>
        calls.push(['publish', segments, metadata]),
      failTranscription: async (...args) => calls.push(['fail', ...args]),
      clearProviderArtifact: async () => calls.push(['clear-artifact']),
      recordProviderArtifact: async () => calls.push(['record-artifact']),
      recordProviderTask: async () => calls.push(['record-task']),
    };
    const worker = new AudioTranscriptionWorker({
      repository,
      preprocessor: {
        createWholeFile: async () => {
          throw new Error('must not preprocess a resumed task');
        },
        cleanup: async () => calls.push(['cleanup-local']),
      },
      dashScope: {
        submit: async () => {
          throw new Error('must not submit a resumed task');
        },
        waitForResult: async (taskId) => {
          calls.push(['poll', taskId]);
          return {
            taskId,
            segments: [
              {
                speakerKey: 'Speaker 0',
                businessRole: 'unknown',
                emotion: 'unknown',
                startMs: 0,
                endMs: 1_000,
                text: '恢复成功',
              },
            ],
          };
        },
      },
      ossStaging: {
        upload: async () => {
          throw new Error('must not upload a resumed task');
        },
        signedGetUrl: () => {
          throw new Error('must not sign a resumed task');
        },
        delete: async (key) => calls.push(['delete', key]),
      },
    });

    await worker.start();
    await worker.stop();

    assert.ok(calls.some((call) => call[0] === 'poll' && call[1] === 'task-existing'));
    assert.ok(calls.some((call) => call[0] === 'publish'));
    assert.ok(calls.some((call) => call[0] === 'delete'));
    assert.ok(calls.some((call) => call[0] === 'clear-artifact'));
    assert.equal(
      calls.some((call) => call[0] === 'record-task'),
      false,
    );
    assert.equal(
      calls.some((call) => call[0] === 'fail'),
      false,
    );
    const publication = calls.find((call) => call[0] === 'publish')[2];
    assert.equal(publication.segmentationMode, 'speaker_turn');
    assert.equal(publication.speakerIdentityScope, 'recording');
  });

  it('restores a persisted Silero timeline when polling a resumed provider task', async () => {
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
    const job = {
      audioFileId: '40000000-0000-4000-8000-000000000001',
      dataSource: null,
      durationMs: 100_000,
      ingestionRunId: null,
      mimeType: 'audio/mpeg',
      model: 'qwen-audio-3.0-asr-flash-filetrans',
      originalFilename: 'meeting.mp3',
      preprocessingManifest: manifest,
      preprocessingMode: 'silero_vad',
      revisionId: '50000000-0000-4000-8000-000000000001',
      revisionNo: 2,
      sizeBytes: 1_024,
      provider: 'dashscope',
      providerArtifactKey: 'echowave/asr-staging/tenant/revision/audio.mp3',
      providerSubmittedAt: new Date('2026-08-26T00:00:00.000Z'),
      providerTaskId: 'task-existing',
      segmentationMode: 'speaker_turn',
      storageKey: 'meeting.mp3',
      title: '客户访谈',
    };
    let claimed = false;
    let published;
    let pollContext;
    const worker = new AudioTranscriptionWorker({
      repository: {
        resetInterruptedTranscriptions: async () => undefined,
        claimTranscription: async () => {
          if (claimed) return undefined;
          claimed = true;
          return job;
        },
        updateActivity: async () => undefined,
        publishTranscription: async (_job, segments) => {
          published = segments;
        },
        failTranscription: async () => assert.fail('must not fail'),
        clearProviderArtifact: async () => undefined,
      },
      preprocessor: {
        createWholeFile: async () => assert.fail('must not preprocess'),
        cleanup: async () => undefined,
      },
      dashScope: {
        submit: async () => assert.fail('must not submit'),
        waitForResult: async (taskId, submittedAt, context) => {
          pollContext = context;
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
              },
            ],
          };
        },
      },
      ossStaging: {
        signedGetUrl: () => assert.fail('must not sign'),
        delete: async () => undefined,
      },
    });

    await worker.start();
    await worker.stop();

    assert.deepEqual(pollContext, {
      revisionId: job.revisionId,
      durationMs: 12_000,
      preprocessing: 'silero_vad',
    });
    assert.deepEqual(
      published.map(({ startMs, endMs }) => ({ startMs, endMs })),
      [{ startMs: 40_100, endMs: 40_900 }],
    );
  });
});
