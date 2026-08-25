/**
 * FFmpeg 音频预处理器测试。
 *
 * 验证外部可执行文件检查、45 秒无重叠分块与十秒自适应下限。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  AudioInputPreprocessor,
  FfmpegAudioPreprocessor,
} from '../../../dist/workspace/transcription/audioPreprocessor.js';

describe('FfmpegAudioPreprocessor', () => {
  it('verifies FFmpeg and creates bounded non-overlapping MP3 chunks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echowave-preprocessor-'));
    const calls = [];
    const preprocessor = new FfmpegAudioPreprocessor({
      audioStorageDirectory: path.join(root, 'audio'),
      ffmpegPath: 'ffmpeg-test',
      tempDirectory: path.join(root, 'temp'),
      processRunner: async (executable, args) => calls.push({ executable, args }),
    });
    try {
      await preprocessor.verify();
      const job = {
        audioFileId: '40000000-0000-4000-8000-000000000001',
        durationMs: 100_000,
        mimeType: 'audio/webm',
        preprocessingMode: 'ffmpeg',
        revisionId: '50000000-0000-4000-8000-000000000001',
        revisionNo: 1,
        sizeBytes: 1_000,
        storageKey: 'stored.webm',
        title: '访谈',
      };
      const chunks = await preprocessor.createChunks(job);

      assert.deepEqual(calls[0], { executable: 'ffmpeg-test', args: ['-version'] });
      assert.equal(chunks.length, 3);
      assert.deepEqual(
        chunks.map(({ offsetMs, primaryStartMs, primaryEndMs }) => ({
          offsetMs,
          primaryStartMs,
          primaryEndMs,
        })),
        [
          { offsetMs: 0, primaryStartMs: 0, primaryEndMs: 45_000 },
          { offsetMs: 45_000, primaryStartMs: 45_000, primaryEndMs: 90_000 },
          { offsetMs: 90_000, primaryStartMs: 90_000, primaryEndMs: 100_000 },
        ],
      );
      assert.ok(calls[1].args.includes('16000'));
      assert.ok(calls[1].args.includes('64k'));
      assert.ok(calls[1].args.at(-1).endsWith('.mp3'));
      assert.equal(chunks[0].format, 'mp3');

      const children = await preprocessor.splitChunk(job, chunks[0]);
      assert.deepEqual(
        children.map(({ durationMs, offsetMs, primaryStartMs, primaryEndMs }) => ({
          durationMs,
          offsetMs,
          primaryStartMs,
          primaryEndMs,
        })),
        [
          {
            durationMs: 22_500,
            offsetMs: 0,
            primaryStartMs: 0,
            primaryEndMs: 22_500,
          },
          {
            durationMs: 22_500,
            offsetMs: 22_500,
            primaryStartMs: 22_500,
            primaryEndMs: 45_000,
          },
        ],
      );
      const grandchildren = await preprocessor.splitChunk(job, children[0]);
      assert.deepEqual(
        grandchildren.map(({ durationMs, offsetMs, primaryStartMs, primaryEndMs }) => ({
          durationMs,
          offsetMs,
          primaryStartMs,
          primaryEndMs,
        })),
        [
          {
            durationMs: 11_250,
            offsetMs: 0,
            primaryStartMs: 0,
            primaryEndMs: 11_250,
          },
          {
            durationMs: 11_250,
            offsetMs: 11_250,
            primaryStartMs: 11_250,
            primaryEndMs: 22_500,
          },
        ],
      );
      await assert.rejects(() => preprocessor.splitChunk(job, grandchildren[0]), /十秒下限/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps all supported source formats as one direct chunk without FFmpeg or temporary files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echowave-direct-'));
    const preprocessor = new AudioInputPreprocessor({
      audioStorageDirectory: path.join(root, 'audio'),
      tempDirectory: path.join(root, 'temp'),
      defaultModel: 'x-ai/grok-stt-1.0',
    });
    try {
      const capabilities = await preprocessor.probeFfmpeg();
      assert.deepEqual(capabilities.ffmpeg, { configured: false, available: false });
      for (const format of capabilities.direct.formats) {
        const job = {
          audioFileId: '40000000-0000-4000-8000-000000000001',
          durationMs: 1_000,
          mimeType: `audio/${format}`,
          preprocessingMode: 'direct',
          revisionId: '50000000-0000-4000-8000-000000000001',
          revisionNo: 1,
          sizeBytes: 1_000,
          storageKey: `stored.${format}`,
          title: '访谈',
        };
        const chunks = await preprocessor.createChunks(job);
        assert.equal(chunks.length, 1);
        assert.equal(chunks[0].format, format);
        assert.equal(chunks[0].offsetMs, 0);
        assert.equal(chunks[0].primaryEndMs, 1_000);
        await preprocessor.cleanup(job);
      }
      await assert.rejects(
        () =>
          preprocessor.createChunks({
            audioFileId: '40000000-0000-4000-8000-000000000001',
            durationMs: 45_001,
            mimeType: 'audio/mpeg',
            preprocessingMode: 'direct',
            revisionId: '50000000-0000-4000-8000-000000000001',
            revisionNo: 1,
            sizeBytes: 1_000,
            storageKey: 'stored.mp3',
            title: '长录音',
          }),
        /启用 FFmpeg/,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('reports a configured but unavailable FFmpeg without throwing', async () => {
    const preprocessor = new AudioInputPreprocessor({
      audioStorageDirectory: '.data/audio',
      ffmpegPath: 'missing-ffmpeg',
      tempDirectory: '.tmp/audio-transcription',
      processRunner: async () => {
        throw new Error('missing');
      },
      defaultModel: 'x-ai/grok-stt-1.0',
    });

    assert.deepEqual((await preprocessor.probeFfmpeg()).ffmpeg, {
      configured: true,
      available: false,
    });
  });

  it('reports FFmpeg as available after a successful non-fatal probe', async () => {
    const calls = [];
    const preprocessor = new AudioInputPreprocessor({
      audioStorageDirectory: '.data/audio',
      ffmpegPath: 'ffmpeg-test',
      tempDirectory: '.tmp/audio-transcription',
      processRunner: async (executable, args) => calls.push({ executable, args }),
      defaultModel: 'x-ai/grok-stt-1.0',
    });

    assert.deepEqual((await preprocessor.probeFfmpeg()).ffmpeg, {
      configured: true,
      available: true,
    });
    assert.deepEqual(calls, [{ executable: 'ffmpeg-test', args: ['-version'] }]);
  });
});
