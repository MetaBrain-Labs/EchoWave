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

function createReportRecorder() {
  const recorded = { modelCalls: [], outputs: [], steps: [] };
  return {
    recorded,
    report: {
      recordMetadata: () => undefined,
      recordStep: (value) => recorded.steps.push(value),
      recordModelCall: (value) => recorded.modelCalls.push(value),
      recordToolCall: () => undefined,
      recordContext: () => undefined,
      recordReasoning: () => undefined,
      recordOutput: (value) => recorded.outputs.push(value),
      finish: async () => undefined,
    },
  };
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

    const { report, recorded } = createReportRecorder();
    await assert.rejects(
      withAudio((audioPath) =>
        asr.transcribeChunk({
          audioPath,
          durationMs: 1_000,
          format: 'mp3',
          knownSpeakers: [],
          preprocessingMode: 'ffmpeg',
          chunkCount: 3,
          chunkIndex: 2,
          report,
        }),
      ),
      (error) => {
        assert.ok(error instanceof AudioTranscriptionProviderError);
        assert.equal(error.code, 'INVALID_MODEL_OUTPUT');
        assert.equal(error.details.category, 'semantic_validation');
        assert.equal(error.details.chunkIndex, 2);
        assert.deepEqual(
          error.details.issues.map((issue) => issue.code),
          ['unknown_speaker', 'timestamp_out_of_bounds'],
        );
        return true;
      },
    );
    assert.equal(requests, 2);
    assert.equal(recorded.outputs.length, 2);
    assert.equal(recorded.modelCalls.length, 2);
  });

  it('diagnoses invalid JSON and caps each failed output at 20,000 characters', async () => {
    const { report, recorded } = createReportRecorder();
    const invalid = `not-json-${'x'.repeat(21_000)}`;
    const asr = new OpenRouterAsr({
      apiKey: 'test-key',
      model: 'google/gemini-2.5-flash-lite',
      fetchImplementation: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: invalid } }] }), {
          status: 200,
        }),
    });

    await assert.rejects(
      withAudio((audioPath) =>
        asr.transcribeChunk({
          audioPath,
          durationMs: 1_000,
          format: 'mp3',
          knownSpeakers: [],
          preprocessingMode: 'ffmpeg',
          report,
        }),
      ),
      (error) => {
        assert.equal(error.details.category, 'invalid_json');
        assert.equal(error.details.structureAttempts, 2);
        assert.equal(error.details.outputLength, invalid.length);
        assert.match(error.details.outputSha256, /^[a-f0-9]{64}$/);
        assert.doesNotMatch(JSON.stringify(error.details), /not-json/);
        return true;
      },
    );
    assert.equal(recorded.outputs.length, 2);
    assert.ok(recorded.outputs.every((output) => output.content.length === 20_000));
    assert.ok(recorded.outputs.every((output) => output.truncated === true));
  });

  it('reports schema paths and allows the correction attempt to succeed', async () => {
    const { report, recorded } = createReportRecorder();
    let requests = 0;
    const asr = new OpenRouterAsr({
      apiKey: 'test-key',
      model: 'google/gemini-2.5-flash-lite',
      fetchImplementation: async () => {
        requests += 1;
        const content =
          requests === 1
            ? JSON.stringify({ speakers: [{ speakerKey: 'Speaker 0' }], segments: [] })
            : JSON.stringify({
                speakers: [{ speakerKey: 'Speaker 0', businessRole: '客户' }],
                segments: [
                  {
                    speakerKey: 'Speaker 0',
                    emotion: 'neutral',
                    startMs: 0,
                    endMs: 500,
                    text: '您好',
                  },
                ],
              });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
            provider: 'Google AI Studio',
            usage: {
              prompt_tokens: 12,
              completion_tokens: 8,
              total_tokens: 20,
              cost: 0.001,
              prompt_tokens_details: { audio_tokens: 7 },
            },
          }),
          { status: 200 },
        );
      },
    });

    const result = await withAudio((audioPath) =>
      asr.transcribeChunk({
        audioPath,
        durationMs: 1_000,
        format: 'mp3',
        knownSpeakers: [],
        preprocessingMode: 'ffmpeg',
        report,
      }),
    );
    assert.equal(result.segments[0].text, '您好');
    assert.equal(recorded.outputs.length, 1);
    assert.equal(recorded.steps[0].metadata.category, 'schema_validation');
    assert.equal(recorded.steps[0].metadata.issues[0].path, 'speakers.0.businessRole');
    assert.equal(recorded.modelCalls.at(-1).inputTokens, 12);
    assert.equal(recorded.modelCalls.at(-1).outputTokens, 8);
    assert.equal(recorded.modelCalls.at(-1).estimatedCostUsd, 0.001);
    assert.equal(recorded.modelCalls.at(-1).provider, 'Google AI Studio');
    assert.equal(recorded.modelCalls.at(-1).metadata.audioTokens, 7);
  });

  it('diagnoses duplicate speakers, negative timestamps, and invalid ranges', async () => {
    const asr = new OpenRouterAsr({
      apiKey: 'test-key',
      model: 'google/gemini-2.5-flash-lite',
      fetchImplementation: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    speakers: [
                      { speakerKey: 'Speaker 0', businessRole: '客户' },
                      { speakerKey: 'Speaker 0', businessRole: '销售' },
                    ],
                    segments: [
                      {
                        speakerKey: 'Speaker 0',
                        emotion: 'neutral',
                        startMs: -10,
                        endMs: -20,
                        text: '错误时间戳',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
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
      (error) => {
        assert.equal(error.details.category, 'semantic_validation');
        const codes = error.details.issues.map((issue) => issue.code);
        assert.ok(codes.includes('duplicate_speaker'));
        assert.ok(codes.includes('negative_timestamp'));
        assert.ok(codes.includes('invalid_time_range'));
        return true;
      },
    );
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
