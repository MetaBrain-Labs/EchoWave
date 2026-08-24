/**
 * OpenRouter ASR 适配器测试。
 *
 * 验证音频负载、固定模型、结构化输出参数和模型结果信任边界。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  AudioTranscriptionProviderError,
  OpenRouterAsr,
} from '../../../dist/workspace/transcription/openRouterAsr.js';

async function withAudio(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'echowave-asr-'));
  const audioPath = path.join(directory, 'chunk.mp3');
  await writeFile(audioPath, new Uint8Array([1, 2, 3]));
  try {
    return await run(audioPath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

describe('OpenRouterAsr', () => {
  it('sends base64 audio with strict structured-output routing', async () => {
    let payload;
    const asr = new OpenRouterAsr({
      apiKey: 'test-key',
      model: 'google/gemini-2.5-flash-lite',
      fetchImplementation: async (_url, init) => {
        payload = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    speakers: [{ speakerKey: 'Speaker 0', businessRole: '销售' }],
                    segments: [
                      {
                        speakerKey: 'Speaker 0',
                        emotion: 'neutral',
                        startMs: 0,
                        endMs: 900,
                        text: '您好',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    const result = await withAudio((audioPath) =>
      asr.transcribeChunk({
        audioPath,
        durationMs: 1_000,
        format: 'webm',
        knownSpeakers: [],
        preprocessingMode: 'direct',
      }),
    );

    assert.equal(result.segments[0].text, '您好');
    assert.equal(payload.model, 'google/gemini-2.5-flash-lite');
    assert.equal(payload.messages[0].content[1].type, 'input_audio');
    assert.equal(payload.messages[0].content[1].input_audio.data, 'AQID');
    assert.equal(payload.messages[0].content[1].input_audio.format, 'webm');
    assert.equal(payload.response_format.type, 'json_schema');
    assert.equal(payload.response_format.json_schema.strict, true);
    assert.equal(payload.provider.require_parameters, true);
  });

  it('rejects dangling speakers and out-of-range timestamps after correction retry', async () => {
    let requests = 0;
    const asr = new OpenRouterAsr({
      apiKey: 'test-key',
      model: 'google/gemini-2.5-flash-lite',
      fetchImplementation: async () => {
        requests += 1;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    speakers: [],
                    segments: [
                      {
                        speakerKey: 'Speaker 9',
                        emotion: 'neutral',
                        startMs: 0,
                        endMs: 2_000,
                        text: 'invalid',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    await assert.rejects(
      withAudio((audioPath) =>
        asr.transcribeChunk({
          audioPath,
          durationMs: 1_000,
          format: 'mp3',
          knownSpeakers: [],
          preprocessingMode: 'ffmpeg',
        }),
      ),
      (error) =>
        error instanceof AudioTranscriptionProviderError && error.code === 'INVALID_MODEL_OUTPUT',
    );
    assert.equal(requests, 2);
  });

  it('does not retry a provider rejection for direct source audio', async () => {
    let requests = 0;
    const asr = new OpenRouterAsr({
      apiKey: 'test-key',
      model: 'google/gemini-2.5-flash-lite',
      fetchImplementation: async () => {
        requests += 1;
        return new Response('too large', { status: 413 });
      },
    });

    await assert.rejects(
      withAudio((audioPath) =>
        asr.transcribeChunk({
          audioPath,
          durationMs: 1_000,
          format: 'wav',
          knownSpeakers: [],
          preprocessingMode: 'direct',
        }),
      ),
      (error) =>
        error instanceof AudioTranscriptionProviderError &&
        error.code === 'DIRECT_AUDIO_REJECTED' &&
        error.retryable === false &&
        error.providerHttpStatus === 413,
    );
    assert.equal(requests, 1);
  });

  it('preserves a safe provider HTTP status without retrying a routing rejection', async () => {
    let requests = 0;
    const asr = new OpenRouterAsr({
      apiKey: 'test-key',
      model: 'google/gemini-2.5-flash-lite',
      fetchImplementation: async () => {
        requests += 1;
        return new Response(JSON.stringify({ error: { message: 'sensitive provider detail' } }), {
          status: 404,
        });
      },
    });

    await assert.rejects(
      withAudio((audioPath) =>
        asr.transcribeChunk({
          audioPath,
          durationMs: 1_000,
          format: 'mp3',
          knownSpeakers: [],
          preprocessingMode: 'ffmpeg',
        }),
      ),
      (error) =>
        error instanceof AudioTranscriptionProviderError &&
        error.code === 'MODEL_UNAVAILABLE' &&
        error.retryable === false &&
        error.providerHttpStatus === 404 &&
        !error.message.includes('sensitive provider detail'),
    );
    assert.equal(requests, 1);
  });
});
