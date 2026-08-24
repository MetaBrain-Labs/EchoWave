/**
 * 音频分块合并测试。
 *
 * 验证全局时间偏移、重叠归属和 Speaker 连续编号。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioTranscriptionProviderError } from '../../../dist/workspace/transcription/openRouterAsr.js';
import {
  AudioTranscriptionWorker,
  mergeChunkSegments,
} from '../../../dist/workspace/transcription/worker.js';

const job = {
  audioFileId: '40000000-0000-4000-8000-000000000001',
  dataSource: {
    id: '20000000-0000-4000-8000-000000000001',
    name: '团队录音空间',
    sourceType: 'manual_upload',
    location: 'local',
    connectionStatus: 'connected',
  },
  durationMs: 1_000,
  ingestionRunId: '30000000-0000-4000-8000-000000000001',
  mimeType: 'audio/wav',
  model: 'google/gemini-2.5-flash-lite',
  originalFilename: 'meeting.wav',
  preprocessingMode: 'direct',
  revisionId: '50000000-0000-4000-8000-000000000001',
  revisionNo: 2,
  sizeBytes: 1_024,
  storageKey: 'private/storage.wav',
  title: '客户访谈',
};

function reportHarness() {
  const recorded = {
    finish: [],
    metadata: undefined,
    modelCalls: [],
    outputs: [],
    steps: [],
    toolCalls: [],
  };
  const recorder = {
    recordMetadata: () => undefined,
    recordStep: (value) => recorded.steps.push(value),
    recordModelCall: (value) => recorded.modelCalls.push(value),
    recordToolCall: (value) => recorded.toolCalls.push(value),
    recordContext: () => undefined,
    recordReasoning: () => undefined,
    recordOutput: (value) => recorded.outputs.push(value),
    finish: async (value) => recorded.finish.push(value),
  };
  return {
    recorded,
    reporter: {
      start: (value) => {
        recorded.metadata = value;
        return recorder;
      },
    },
  };
}

describe('audio transcription merge', () => {
  it('keeps one overlap copy and normalizes speakers by first appearance', () => {
    const segments = mergeChunkSegments(
      [
        {
          chunk: {
            path: 'one.mp3',
            durationMs: 602_000,
            format: 'mp3',
            offsetMs: 0,
            primaryStartMs: 0,
            primaryEndMs: 600_000,
          },
          result: {
            speakers: [{ speakerKey: 'Speaker 4', businessRole: '销售' }],
            segments: [
              {
                speakerKey: 'Speaker 4',
                emotion: 'neutral',
                startMs: 599_000,
                endMs: 601_000,
                text: '跨段内容',
              },
            ],
          },
        },
        {
          chunk: {
            path: 'two.mp3',
            durationMs: 12_000,
            format: 'mp3',
            offsetMs: 598_000,
            primaryStartMs: 600_000,
            primaryEndMs: 610_000,
          },
          result: {
            speakers: [{ speakerKey: 'Speaker 4', businessRole: '销售' }],
            segments: [
              {
                speakerKey: 'Speaker 4',
                emotion: 'neutral',
                startMs: 1_000,
                endMs: 3_000,
                text: '跨段内容',
              },
              {
                speakerKey: 'Speaker 4',
                emotion: 'happy',
                startMs: 4_000,
                endMs: 6_000,
                text: '下一句',
              },
            ],
          },
        },
      ],
      610_000,
    );

    assert.deepEqual(
      segments.map(({ speakerKey, startMs, text }) => ({ speakerKey, startMs, text })),
      [
        { speakerKey: 'Speaker 0', startMs: 599_000, text: '跨段内容' },
        { speakerKey: 'Speaker 0', startMs: 602_000, text: '下一句' },
      ],
    );
  });

  it('deduplicates text-similar overlap copies when timestamps drift across the boundary', () => {
    const segments = mergeChunkSegments(
      [
        {
          chunk: {
            path: 'one.mp3',
            durationMs: 602_000,
            format: 'mp3',
            offsetMs: 0,
            primaryStartMs: 0,
            primaryEndMs: 600_000,
          },
          result: {
            speakers: [{ speakerKey: 'Speaker 0', businessRole: '客户' }],
            segments: [
              {
                speakerKey: 'Speaker 0',
                emotion: 'neutral',
                startMs: 598_800,
                endMs: 599_900,
                text: '这个方案可以接受',
              },
            ],
          },
        },
        {
          chunk: {
            path: 'two.mp3',
            durationMs: 12_000,
            format: 'mp3',
            offsetMs: 598_000,
            primaryStartMs: 600_000,
            primaryEndMs: 610_000,
          },
          result: {
            speakers: [{ speakerKey: 'Speaker 0', businessRole: '客户' }],
            segments: [
              {
                speakerKey: 'Speaker 0',
                emotion: 'neutral',
                startMs: 1_300,
                endMs: 3_100,
                text: '这个方案，可以接受',
              },
            ],
          },
        },
      ],
      610_000,
    );

    assert.equal(segments.length, 1);
    assert.equal(segments[0].text, '这个方案，可以接受');
  });
});

describe('audio transcription execution reports', () => {
  it('records safe source metadata and the complete direct-mode step timeline', async () => {
    const { recorded, reporter } = reportHarness();
    const calls = { cleanup: 0, publish: [], progress: [] };
    const worker = new AudioTranscriptionWorker({
      reporter,
      preprocessor: {
        createChunks: async () => [
          {
            path: 'private/source.wav',
            durationMs: 1_000,
            format: 'wav',
            offsetMs: 0,
            primaryStartMs: 0,
            primaryEndMs: 1_000,
          },
        ],
        cleanup: async () => {
          calls.cleanup += 1;
        },
      },
      asr: {
        transcribeChunk: async () => ({
          speakers: [{ speakerKey: 'Speaker 0', businessRole: '客户' }],
          segments: [
            {
              speakerKey: 'Speaker 0',
              emotion: 'neutral',
              startMs: 0,
              endMs: 900,
              text: '测试正文',
            },
          ],
        }),
      },
      repository: {
        setProgress: async (_job, value) => calls.progress.push(value),
        publishTranscription: async (_job, value) => calls.publish.push(value),
      },
    });

    await worker.execute(job);

    assert.equal(recorded.metadata.kind, 'audio-transcription');
    assert.equal(recorded.metadata.metadata.source.dataSource.name, '团队录音空间');
    assert.equal(recorded.metadata.metadata.audio.originalFilename, 'meeting.wav');
    assert.equal('storageKey' in recorded.metadata.metadata.audio, false);
    assert.deepEqual(
      recorded.steps.filter((step) => step.status === 'completed').map((step) => step.name),
      ['preprocess', 'transcribe', 'validate-merge', 'publish', 'cleanup'],
    );
    assert.equal(recorded.steps[1].metadata.preprocessingMode, 'direct');
    assert.equal(recorded.steps[1].metadata.chunks[0].path, undefined);
    assert.equal(calls.publish[0][0].text, '测试正文');
    assert.equal(calls.cleanup, 1);
    assert.equal(recorded.finish[0].status, 'completed');
  });

  it('persists structured failure diagnostics and records failure cleanup', async () => {
    const { recorded, reporter } = reportHarness();
    const persisted = [];
    let cleanupCount = 0;
    const details = {
      category: 'invalid_json',
      chunkIndex: 1,
      chunkCount: 1,
      structureAttempts: 2,
      issues: [{ path: '$', code: 'invalid_json', message: '模型输出不是有效 JSON。' }],
      outputLength: 12,
      outputSha256: 'a'.repeat(64),
    };
    const worker = new AudioTranscriptionWorker({
      reporter,
      preprocessor: {
        createChunks: async () => [
          {
            path: 'private/source.wav',
            durationMs: 1_000,
            format: 'wav',
            offsetMs: 0,
            primaryStartMs: 0,
            primaryEndMs: 1_000,
          },
        ],
        cleanup: async () => {
          cleanupCount += 1;
        },
      },
      asr: {
        transcribeChunk: async () => {
          throw new AudioTranscriptionProviderError(
            'INVALID_MODEL_OUTPUT',
            '模型输出不是有效 JSON。',
            true,
            undefined,
            details,
          );
        },
      },
      repository: {
        setProgress: async () => undefined,
        failTranscription: async (...values) => persisted.push(values),
      },
    });

    await worker.execute(job);

    assert.equal(persisted.length, 1);
    assert.equal(persisted[0][1], 'INVALID_MODEL_OUTPUT');
    assert.deepEqual(persisted[0][4], details);
    assert.equal(cleanupCount, 1);
    assert.deepEqual(
      recorded.steps.filter((step) => step.status === 'completed').map((step) => step.name),
      ['preprocess', 'persist-failure', 'cleanup-failure'],
    );
    assert.equal(recorded.finish[0].status, 'failed');
    assert.deepEqual(recorded.finish[0].metadata.details, details);
  });
});
