/**
 * OpenRouter STT 适配器测试。
 *
 * 验证多种响应粒度、安全时间戳校验和 Grok diarization 请求，不访问真实供应商。
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  AudioTranscriptionProviderError,
  OpenRouterStt,
  normalizeSttResponse,
} from '../../../dist/workspace/transcription/openRouterStt.js';

describe('OpenRouterStt', () => {
  it('groups Grok words by speaker, pause and punctuation', () => {
    const result = normalizeSttResponse(
      {
        text: '你好。欢迎光临',
        words: [
          { text: '你好。', start: 0, end: 0.5, speaker: 2 },
          { text: '欢迎', start: 0.55, end: 0.9, speaker: 2 },
          { text: '光临', start: 1, end: 1.3, speaker: 3 },
        ],
      },
      2_000,
    );
    assert.deepEqual(
      result.segments.map(({ speakerKey, startMs, endMs, text, businessRole, emotion }) => ({
        speakerKey,
        startMs,
        endMs,
        text,
        businessRole,
        emotion,
      })),
      [
        {
          speakerKey: 'Speaker 0',
          startMs: 0,
          endMs: 500,
          text: '你好。',
          businessRole: 'unknown',
          emotion: 'unknown',
        },
        {
          speakerKey: 'Speaker 0',
          startMs: 550,
          endMs: 900,
          text: '欢迎',
          businessRole: 'unknown',
          emotion: 'unknown',
        },
        {
          speakerKey: 'Speaker 1',
          startMs: 1_000,
          endMs: 1_300,
          text: '光临',
          businessRole: 'unknown',
          emotion: 'unknown',
        },
      ],
    );
  });

  it('uses Speaker 0 for words without speaker and accepts segments', () => {
    const words = normalizeSttResponse(
      {
        text: 'hello world',
        words: [
          { word: 'hello', start: 0, end: 0.4 },
          { word: 'world', start: 0.5, end: 1 },
        ],
      },
      2_000,
    );
    assert.equal(words.segments[0].speakerKey, 'Speaker 0');
    assert.equal(words.segments[0].text, 'hello world');

    const segments = normalizeSttResponse(
      {
        text: '甲乙',
        segments: [
          { text: '甲', start: 0, end: 0.5 },
          { text: '乙', start: 0.5, end: 1 },
        ],
      },
      2_000,
    );
    assert.equal(segments.segments.length, 2);
  });

  it('merges multichannel words in timestamp order and keeps channels as speakers', () => {
    const result = normalizeSttResponse(
      {
        text: '甲乙',
        channels: [
          { words: [{ text: '乙', start: 1, end: 1.4 }] },
          { words: [{ text: '甲', start: 0, end: 0.4 }] },
        ],
      },
      2_000,
    );
    assert.deepEqual(
      result.segments.map(({ text, speakerKey }) => ({ text, speakerKey })),
      [
        { text: '甲', speakerKey: 'Speaker 0' },
        { text: '乙', speakerKey: 'Speaker 1' },
      ],
    );
  });

  it('creates a coarse segment for text and no segments for empty text', () => {
    assert.deepEqual(normalizeSttResponse({ text: '完整正文' }, 3_000).segments[0], {
      speakerKey: 'Speaker 0',
      businessRole: 'unknown',
      emotion: 'unknown',
      startMs: 0,
      endMs: 3_000,
      text: '完整正文',
    });
    assert.deepEqual(normalizeSttResponse({ text: '' }, 3_000).segments, []);
  });

  it('rejects out-of-range and out-of-order timestamps', () => {
    for (const words of [
      [{ text: '越界', start: 0, end: 4 }],
      [
        { text: '后', start: 1, end: 1.2 },
        { text: '前', start: 0.5, end: 0.8 },
      ],
    ]) {
      assert.throws(
        () => normalizeSttResponse({ text: '测试', words }, 2_000),
        AudioTranscriptionProviderError,
      );
    }
  });

  it('sends Grok diarization options to the STT endpoint', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'echowave-stt-'));
    const audioPath = path.join(directory, 'chunk.mp3');
    await writeFile(audioPath, Buffer.from('audio'));
    let request;
    const stt = new OpenRouterStt({
      apiKey: 'test-key',
      fetchImplementation: async (url, init) => {
        request = { url, init };
        return new Response(JSON.stringify({ text: '测试' }), {
          status: 200,
          headers: { 'x-generation-id': 'generation-1' },
        });
      },
    });
    try {
      const result = await stt.transcribeChunk({
        audioPath,
        chunkCount: 1,
        chunkIndex: 1,
        durationMs: 1_000,
        format: 'mp3',
        model: 'x-ai/grok-stt-1.0',
        preprocessingMode: 'ffmpeg',
      });
      const body = JSON.parse(request.init.body);
      assert.equal(request.url, 'https://openrouter.ai/api/v1/audio/transcriptions');
      assert.equal(body.model, 'x-ai/grok-stt-1.0');
      assert.equal(body.provider.options.xai.diarize, true);
      assert.equal(body.messages, undefined);
      assert.equal(body.response_format, undefined);
      assert.equal(result.generationId, 'generation-1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not retry authentication failures', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'echowave-stt-'));
    const audioPath = path.join(directory, 'chunk.mp3');
    await writeFile(audioPath, Buffer.from('audio'));
    let calls = 0;
    const stt = new OpenRouterStt({
      apiKey: 'bad-key',
      fetchImplementation: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: 'secret provider text' } }), {
          status: 401,
        });
      },
    });
    try {
      await assert.rejects(
        stt.transcribeChunk({
          audioPath,
          chunkCount: 1,
          chunkIndex: 1,
          durationMs: 1_000,
          format: 'mp3',
          model: 'openai/whisper-large-v3',
          preprocessingMode: 'ffmpeg',
        }),
        (error) => error instanceof AudioTranscriptionProviderError && error.retryable === false,
      );
      assert.equal(calls, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
