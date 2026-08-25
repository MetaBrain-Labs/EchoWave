/**
 * 音频 STT Worker 测试。
 *
 * 验证无重叠分块的全局时间换算，以及质量退化后的原位自适应拆分。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioTranscriptionSplitRequiredError } from '../../../dist/workspace/transcription/openRouterStt.js';
import {
  AudioTranscriptionWorker,
  mergeChunkSegments,
} from '../../../dist/workspace/transcription/worker.js';

const job = {
  audioFileId: '40000000-0000-4000-8000-000000000001',
  dataSource: null,
  durationMs: 45_000,
  ingestionRunId: null,
  mimeType: 'audio/mpeg',
  model: 'x-ai/grok-stt-1.0',
  originalFilename: 'meeting.mp3',
  preprocessingMode: 'ffmpeg',
  revisionId: '50000000-0000-4000-8000-000000000001',
  revisionNo: 2,
  sizeBytes: 1_024,
  storageKey: 'meeting.mp3',
  title: '客户访谈',
};

function result(text, startMs, endMs, speakerKey = 'Speaker 0') {
  return {
    speakers: [{ speakerKey, businessRole: 'unknown' }],
    segments: [
      {
        speakerKey,
        businessRole: 'unknown',
        emotion: 'unknown',
        startMs,
        endMs,
        text,
      },
    ],
  };
}

describe('audio transcription merge', () => {
  it('converts chunk-local timestamps and canonicalizes speakers', () => {
    const merged = mergeChunkSegments(
      [
        {
          chunk: {
            path: 'one.mp3',
            durationMs: 22_500,
            format: 'mp3',
            offsetMs: 0,
            primaryStartMs: 0,
            primaryEndMs: 22_500,
          },
          result: result('第一段', 1_000, 2_000, 'speaker:a'),
        },
        {
          chunk: {
            path: 'two.mp3',
            durationMs: 22_500,
            format: 'mp3',
            offsetMs: 22_500,
            primaryStartMs: 22_500,
            primaryEndMs: 45_000,
          },
          result: result('第二段', 500, 1_500, 'speaker:b'),
        },
      ],
      45_000,
    );
    assert.deepEqual(
      merged.map(({ startMs, endMs, speakerKey, businessRole, emotion }) => ({
        startMs,
        endMs,
        speakerKey,
        businessRole,
        emotion,
      })),
      [
        {
          startMs: 1_000,
          endMs: 2_000,
          speakerKey: 'Speaker 0',
          businessRole: 'unknown',
          emotion: 'unknown',
        },
        {
          startMs: 23_000,
          endMs: 24_000,
          speakerKey: 'Speaker 1',
          businessRole: 'unknown',
          emotion: 'unknown',
        },
      ],
    );
  });
});

describe('AudioTranscriptionWorker', () => {
  it('splits a degraded 45-second chunk and keeps the selected model', async () => {
    const rootChunk = {
      path: 'root.mp3',
      durationMs: 45_000,
      format: 'mp3',
      offsetMs: 0,
      primaryStartMs: 0,
      primaryEndMs: 45_000,
    };
    const children = [
      { ...rootChunk, path: 'left.mp3', durationMs: 22_500, primaryEndMs: 22_500 },
      {
        ...rootChunk,
        path: 'right.mp3',
        durationMs: 22_500,
        offsetMs: 22_500,
        primaryStartMs: 22_500,
      },
    ];
    let claimed = false;
    const published = [];
    const failed = [];
    const models = [];
    const repository = {
      resetInterruptedTranscriptions: async () => undefined,
      claimTranscription: async () => {
        if (claimed) return undefined;
        claimed = true;
        return job;
      },
      updateActivity: async () => undefined,
      publishTranscription: async (_job, segments) => published.push(segments),
      failTranscription: async (...args) => failed.push(args),
    };
    const worker = new AudioTranscriptionWorker({
      repository,
      preprocessor: {
        createChunks: async () => [rootChunk],
        splitChunk: async () => children,
        cleanup: async () => undefined,
      },
      stt: {
        transcribeChunk: async (input) => {
          models.push(input.model);
          if (input.audioPath === 'root.mp3') {
            throw new AudioTranscriptionSplitRequiredError(
              'INVALID_MODEL_OUTPUT',
              '退化',
              {
                category: 'semantic_validation',
                chunkIndex: 1,
                chunkCount: 1,
                structureAttempts: 0,
                issues: [{ path: 'segments', code: 'repeated_text_loop', message: '重复' }],
                outputLength: null,
                outputSha256: null,
              },
              'quality_degradation',
            );
          }
          return result(input.audioPath, 0, input.durationMs);
        },
      },
    });
    await worker.start();
    await worker.stop();
    assert.equal(failed.length, 0);
    assert.equal(published.length, 1);
    assert.deepEqual(models, [job.model, job.model, job.model]);
    assert.deepEqual(
      published[0].map(({ startMs, endMs }) => ({ startMs, endMs })),
      [
        { startMs: 0, endMs: 22_500 },
        { startMs: 22_500, endMs: 45_000 },
      ],
    );
  });
});
