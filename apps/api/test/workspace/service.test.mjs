/**
 * 数据源音频上传服务测试。
 *
 * 验证音频结构识别、批次限制、持久化写入与数据库失败后的文件补偿清理。
 *
 * Responsibilities:
 * - 锁定本地音频存储的全成全败边界。
 */
import assert from 'node:assert/strict';
import { Buffer, File } from 'node:buffer';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  AudioUploadValidationError,
  DefaultWorkspaceService,
} from '../../dist/workspace/service.js';
import { WorkspaceRepositoryError } from '../../dist/workspace/persistence/errors.js';
import { AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES } from '@echowave/contracts';

const sourceId = '11111111-1111-4111-8111-111111111111';

function wavFile(name = 'sample.wav') {
  const sampleCount = 800;
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  return new File([buffer], name, { type: 'audio/wav' });
}

function repository(overrides = {}) {
  return {
    getDataSource: async () => ({ id: sourceId }),
    createDataSourceAudioUpload: async (_id, items) => ({
      ingestionRunId: sourceId,
      items,
    }),
    ...overrides,
  };
}

describe('DefaultWorkspaceService audio uploads', () => {
  it('stores a structurally valid audio file and publishes extracted metadata', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'echowave-audio-'));
    let storedItems;
    const service = new DefaultWorkspaceService(
      repository({
        createDataSourceAudioUpload: async (_id, items) => {
          storedItems = items;
          return { ingestionRunId: sourceId, items: [] };
        },
      }),
      root,
    );
    try {
      await service.uploadDataSourceAudioFiles(sourceId, [wavFile('customer.wav')]);
      assert.equal(storedItems.length, 1);
      assert.equal(storedItems[0].originalFilename, 'customer.wav');
      assert.equal(storedItems[0].mimeType, 'audio/wav');
      assert.equal(storedItems[0].durationMs, 100);
      assert.match(storedItems[0].storageKey, /^[0-9a-f-]+\.wav$/);
      assert.deepEqual(await readdir(root), [storedItems[0].storageKey]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unsupported, malformed, and oversized batches before database publication', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'echowave-audio-'));
    let publications = 0;
    const service = new DefaultWorkspaceService(
      repository({
        createDataSourceAudioUpload: async () => {
          publications += 1;
        },
      }),
      root,
    );
    try {
      await assert.rejects(
        () => service.uploadDataSourceAudioFiles(sourceId, [new File(['text'], 'note.txt')]),
        (error) =>
          error instanceof AudioUploadValidationError && error.code === 'UNSUPPORTED_FORMAT',
      );
      await assert.rejects(
        () =>
          service.uploadDataSourceAudioFiles(sourceId, [
            new File(['not audio'], 'fake.wav', { type: 'audio/wav' }),
          ]),
        (error) => error instanceof AudioUploadValidationError && error.code === 'INVALID_FILE',
      );
      await assert.rejects(
        () =>
          service.uploadDataSourceAudioFiles(
            sourceId,
            Array.from({ length: 21 }, () => wavFile()),
          ),
        (error) => error instanceof AudioUploadValidationError && error.code === 'TOO_MANY_FILES',
      );
      await assert.rejects(
        () => service.uploadDataSourceAudioFiles(sourceId, [{ size: 200 * 1024 * 1024 + 1 }]),
        (error) => error instanceof AudioUploadValidationError && error.code === 'AUDIO_TOO_LARGE',
      );
      assert.equal(publications, 0);
      assert.deepEqual(await readdir(root), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes every newly written file when database publication fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'echowave-audio-'));
    const service = new DefaultWorkspaceService(
      repository({
        createDataSourceAudioUpload: async () => {
          throw new Error('database unavailable');
        },
      }),
      root,
    );
    try {
      await assert.rejects(
        () => service.uploadDataSourceAudioFiles(sourceId, [wavFile()]),
        /database unavailable/,
      );
      assert.deepEqual(await readdir(root), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('DefaultWorkspaceService audio playback', () => {
  it('opens a stored file without exposing a path outside AUDIO_STORAGE_DIR', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'echowave-playback-'));
    await writeFile(path.join(root, 'stored.wav'), Buffer.from('audio-bytes'));
    const service = new DefaultWorkspaceService(
      repository({
        getAudioPlaybackSource: async () => ({
          storageKey: 'stored.wav',
          mimeType: 'audio/wav',
          originalFilename: '访谈.wav',
        }),
      }),
      root,
    );
    try {
      const file = await service.getAudioPlaybackFile(sourceId);
      assert.equal(file.absolutePath, path.join(root, 'stored.wav'));
      assert.equal(file.mimeType, 'audio/wav');
      assert.equal(file.sizeBytes, 11);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal keys and missing files as not found', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'echowave-playback-'));
    try {
      for (const storageKey of ['../escape.wav', 'missing.wav']) {
        const service = new DefaultWorkspaceService(
          repository({
            getAudioPlaybackSource: async () => ({
              storageKey,
              mimeType: 'audio/wav',
              originalFilename: '访谈.wav',
            }),
          }),
          root,
        );
        await assert.rejects(
          () => service.getAudioPlaybackFile(sourceId),
          (error) => error instanceof WorkspaceRepositoryError && error.code === 'NOT_FOUND',
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('DefaultWorkspaceService audio transcription', () => {
  it('rechecks FFmpeg before queueing the fixed whole-file route', async () => {
    const queued = [];
    const audioRepository = {
      queueTranscription: async (id, model, preprocessing, segmentationMode) => {
        queued.push({ id, model, preprocessing, segmentationMode });
        return { audioFileId: id, revisionId: sourceId, status: 'queued' };
      },
    };
    const preprocessor = {
      capabilities: () => ({
        defaultModel: 'qwen-audio-3.0-asr-flash-filetrans',
        models: AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
        ffmpeg: { configured: true, available: false },
        sileroVad: {
          model: 'silero-vad-v6.2.1',
          available: false,
          unavailableReason: 'Silero VAD unavailable.',
        },
        transcriptionConfigured: true,
      }),
      refreshModeAvailability: async () => false,
    };
    const service = new DefaultWorkspaceService(
      repository(),
      '.data/audio',
      audioRepository,
      'qwen-audio-3.0-asr-flash-filetrans',
      preprocessor,
    );

    await assert.rejects(
      () => service.startAudioTranscription(sourceId, { preprocessing: 'whole_file' }),
      (error) =>
        error instanceof WorkspaceRepositoryError && error.code === 'TRANSCODER_UNAVAILABLE',
    );
    assert.deepEqual(queued, []);
  });

  it('requires the available Qwen whole-file route for speaker-turn segmentation', async () => {
    const queued = [];
    const models = AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES.map((model) =>
      model.id === 'qwen-audio-3.0-asr-flash-filetrans'
        ? { ...model, available: true, unavailableReason: null }
        : model,
    );
    const audioRepository = {
      queueTranscription: async (...args) => {
        queued.push(args);
        return { audioFileId: args[0], revisionId: sourceId, status: 'queued' };
      },
    };
    const preprocessor = {
      capabilities: () => ({
        defaultModel: 'qwen-audio-3.0-asr-flash-filetrans',
        models,
        ffmpeg: { configured: true, available: true },
        sileroVad: { model: 'silero-vad-v6.2.1', available: true, unavailableReason: null },
        transcriptionConfigured: true,
      }),
      refreshModeAvailability: async () => true,
    };
    const service = new DefaultWorkspaceService(
      repository(),
      '.data/audio',
      audioRepository,
      'qwen-audio-3.0-asr-flash-filetrans',
      preprocessor,
    );

    await service.startAudioTranscription(sourceId, {
      preprocessing: 'whole_file',
      segmentationMode: 'speaker_turn',
    });
    assert.deepEqual(queued[0], [
      sourceId,
      'qwen-audio-3.0-asr-flash-filetrans',
      'whole_file',
      'speaker_turn',
    ]);
    await assert.rejects(
      () =>
        service.startAudioTranscription(sourceId, {
          model: 'unknown/model',
          preprocessing: 'whole_file',
          segmentationMode: 'speaker_turn',
        }),
      (error) => error instanceof TypeError,
    );
  });
});

describe('DefaultWorkspaceService audio post-analysis', () => {
  it('rejects emotion queueing when FFmpeg or the Qwen staging path is unavailable', async () => {
    const queued = [];
    const service = new DefaultWorkspaceService(
      repository(),
      '.data/audio',
      {},
      'qwen-audio-3.0-asr-flash-filetrans',
      { refreshFfmpegAvailability: async () => false },
      { queue: async (...args) => queued.push(args) },
      { confirm: async () => undefined },
      'qwen3.5-omni-flash',
      'deepseek-v4-flash',
      true,
    );

    await assert.rejects(
      () => service.startAudioPostAnalysis(sourceId, 'emotion'),
      (error) => error instanceof WorkspaceRepositoryError && error.code === 'CONFLICT',
    );
    assert.deepEqual(queued, []);
  });

  it('queues role recognition without coupling it to the emotion audio dependencies', async () => {
    const queued = [];
    const service = new DefaultWorkspaceService(
      repository(),
      '.data/audio',
      {},
      'qwen-audio-3.0-asr-flash-filetrans',
      { refreshFfmpegAvailability: async () => false },
      {
        queue: async (...args) => {
          queued.push(args);
          return { audioFileId: args[0], type: args[1] };
        },
      },
      { confirm: async () => undefined },
      'qwen3.5-omni-flash',
      'deepseek-v4-flash',
      false,
    );

    assert.deepEqual(await service.startAudioPostAnalysis(sourceId, 'role'), {
      audioFileId: sourceId,
      type: 'role',
    });
    assert.deepEqual(queued, [[sourceId, 'role', 'deepseek-v4-flash']]);
  });
});
