/**
 * FFmpeg 音频预处理器测试。
 *
 * 验证外部可执行文件检查、固定转码参数与十分钟重叠分块边界。
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
  it('verifies FFmpeg and creates bounded overlapping MP3 chunks', async () => {
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
      const chunks = await preprocessor.createChunks({
        audioFileId: '40000000-0000-4000-8000-000000000001',
        durationMs: 610_000,
        mimeType: 'audio/webm',
        preprocessingMode: 'ffmpeg',
        revisionId: '50000000-0000-4000-8000-000000000001',
        revisionNo: 1,
        sizeBytes: 1_000,
        storageKey: 'stored.webm',
        title: '访谈',
      });

      assert.deepEqual(calls[0], { executable: 'ffmpeg-test', args: ['-version'] });
      assert.equal(chunks.length, 2);
      assert.deepEqual(
        chunks.map(({ offsetMs, primaryStartMs, primaryEndMs }) => ({
          offsetMs,
          primaryStartMs,
          primaryEndMs,
        })),
        [
          { offsetMs: 0, primaryStartMs: 0, primaryEndMs: 600_000 },
          { offsetMs: 598_000, primaryStartMs: 600_000, primaryEndMs: 610_000 },
        ],
      );
      assert.ok(calls[1].args.includes('16000'));
      assert.ok(calls[1].args.includes('64k'));
      assert.ok(calls[1].args.at(-1).endsWith('.mp3'));
      assert.equal(chunks[0].format, 'mp3');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps all supported source formats as one direct chunk without FFmpeg or temporary files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echowave-direct-'));
    const preprocessor = new AudioInputPreprocessor({
      audioStorageDirectory: path.join(root, 'audio'),
      tempDirectory: path.join(root, 'temp'),
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
    });

    assert.deepEqual((await preprocessor.probeFfmpeg()).ffmpeg, {
      configured: true,
      available: true,
    });
    assert.deepEqual(calls, [{ executable: 'ffmpeg-test', args: ['-version'] }]);
  });
});
