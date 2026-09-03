import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  AudioWindowPreprocessingError,
  AudioWindowPreprocessor,
} from '../../../dist/workspace/audio/post-analysis/audioWindowPreprocessor.js';

describe('AudioWindowPreprocessor', () => {
  it('uses a bounded duration and validates the generated window', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echowave-window-'));
    const audioRoot = path.join(root, 'audio');
    const tempRoot = path.join(root, 'temp');
    const source = path.join(audioRoot, 'source.mp3');
    let captured;
    try {
      await mkdir(audioRoot, { recursive: true });
      await writeFile(source, 'source');
      const preprocessor = new AudioWindowPreprocessor({
        audioStorageDirectory: audioRoot,
        tempDirectory: tempRoot,
        ffmpegPath: 'ffmpeg-test',
        processRunner: async (executable, args) => {
          captured = { executable, args };
          await writeFile(args.at(-1), 'window');
        },
      });

      const output = await preprocessor.createWindow({
        jobId: 'job-1',
        storageKey: 'source.mp3',
        windowIndex: 1,
        startMs: 500,
        endMs: 2_500,
      });

      assert.equal(captured.executable, 'ffmpeg-test');
      assert.deepEqual(
        captured.args.slice(captured.args.indexOf('-ss'), captured.args.indexOf('-vn')),
        ['-ss', '0.500', '-i', source, '-t', '2.000'],
      );
      assert.equal(captured.args.includes('-to'), false);
      assert.equal(await readFile(output, 'utf8'), 'window');
      await preprocessor.cleanup('job-1');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('returns a retryable source error before invoking FFmpeg', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echowave-window-'));
    let invoked = false;
    try {
      const preprocessor = new AudioWindowPreprocessor({
        audioStorageDirectory: path.join(root, 'audio'),
        tempDirectory: path.join(root, 'temp'),
        ffmpegPath: 'ffmpeg-test',
        processRunner: async () => {
          invoked = true;
        },
      });

      await assert.rejects(
        () =>
          preprocessor.createWindow({
            jobId: 'job-2',
            storageKey: 'missing.mp3',
            windowIndex: 1,
            startMs: 0,
            endMs: 1_000,
          }),
        (error) => {
          assert.ok(error instanceof AudioWindowPreprocessingError);
          assert.equal(error.code, 'ANALYSIS_PREPROCESSING_FAILED');
          assert.equal(error.retryable, true);
          return true;
        },
      );
      assert.equal(invoked, false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
