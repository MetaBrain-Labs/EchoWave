/**
 * DashScope 整文件音频预处理测试。
 *
 * 验证固定转码参数和转写可用性组合。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  AudioInputPreprocessor,
  FfmpegAudioPreprocessor,
} from '../../../dist/workspace/audio/transcription/audioPreprocessor.js';

const job = {
  audioFileId: '40000000-0000-4000-8000-000000000001',
  durationMs: 100_000,
  mimeType: 'audio/webm',
  preprocessingMode: 'whole_file',
  revisionId: '50000000-0000-4000-8000-000000000001',
  revisionNo: 1,
  sizeBytes: 1_000,
  storageKey: 'stored.webm',
  title: '访谈',
};

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

describe('FfmpegAudioPreprocessor', () => {
  it('creates one 16kHz mono MP3 for the whole recording', async () => {
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
      const wholeFile = await preprocessor.createWholeFile(job);
      assert.deepEqual(calls[0], { executable: 'ffmpeg-test', args: ['-version'] });
      assert.ok(calls[1].args.includes('16000'));
      assert.ok(calls[1].args.includes('1'));
      assert.ok(calls[1].args.at(-1).endsWith('whole-file.mp3'));
      assert.equal(wholeFile.durationMs, 100_000);
      await preprocessor.cleanup(job.revisionId);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('requires DashScope OSS configuration and available FFmpeg together', async () => {
    const unavailable = new AudioInputPreprocessor({
      audioStorageDirectory: '.data/audio',
      tempDirectory: '.tmp/audio-transcription',
      defaultModel: 'qwen-audio-3.0-asr-flash-filetrans',
      transcriptionConfigured: false,
    });
    const unavailableCapabilities = await unavailable.probeFfmpeg();
    assert.equal(unavailableCapabilities.transcriptionConfigured, false);
    assert.equal(unavailableCapabilities.models[0].available, false);

    const available = new AudioInputPreprocessor({
      audioStorageDirectory: '.data/audio',
      ffmpegPath: 'ffmpeg-test',
      tempDirectory: '.tmp/audio-transcription',
      processRunner: async () => undefined,
      voiceActivityDetector: { verify: async () => undefined, detect: async () => manifest },
      defaultModel: 'qwen-audio-3.0-asr-flash-filetrans',
      transcriptionConfigured: true,
    });
    const capabilities = await available.probeFfmpeg();
    assert.deepEqual(capabilities.ffmpeg, { configured: true, available: true });
    assert.equal(capabilities.transcriptionConfigured, true);
    assert.equal(capabilities.models.length, 1);
    assert.equal(capabilities.models[0].available, true);
    assert.equal(capabilities.sileroVad.available, true);
  });

  it('uses the explicit Silero path and returns its processed duration and manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echowave-vad-preprocessor-'));
    const calls = [];
    const preprocessor = new FfmpegAudioPreprocessor({
      audioStorageDirectory: path.join(root, 'audio'),
      ffmpegPath: 'ffmpeg-test',
      tempDirectory: path.join(root, 'temp'),
      processRunner: async () => undefined,
      voiceActivityDetector: { verify: async () => undefined, detect: async () => manifest },
      voiceActivityFileProcessor: {
        detect: async (sourcePath) => {
          calls.push(['detect', sourcePath]);
          return manifest;
        },
        encode: async (sourcePath, outputPath) => calls.push(['encode', sourcePath, outputPath]),
      },
    });
    try {
      const result = await preprocessor.createWholeFile({
        ...job,
        preprocessingMode: 'silero_vad',
      });
      assert.equal(result.durationMs, 12_000);
      assert.equal(result.manifest, manifest);
      assert.deepEqual(
        calls.map(([name]) => name),
        ['detect', 'encode'],
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
