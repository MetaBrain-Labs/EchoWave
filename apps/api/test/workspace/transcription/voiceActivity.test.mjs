/**
 * Silero VAD 过滤策略与时间轴测试。
 *
 * 验证固定阈值、30 秒保留边界、无语音失败和压缩时间轴恢复。
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';

import {
  SILERO_VAD_MODEL_SHA256,
  SileroVoiceActivityDetector,
  buildVoiceActivityManifest,
  restoreOriginalTimeline,
  speechRangesFromProbabilities,
} from '../../../dist/workspace/transcription/voiceActivity.js';

const samples = (milliseconds) => Math.round((milliseconds * 16_000) / 1_000);

describe('Silero voice activity policy', () => {
  it('uses hysteresis and ignores trailing partial silence after closing speech', () => {
    const probabilities = [0.1, 0.6, 0.7, 0.6, 0.2, 0.2, 0.2, 0.1];
    assert.deepEqual(speechRangesFromProbabilities(probabilities, 8 * 512), [
      { startSample: 512, endSample: 4 * 512 },
    ]);
    assert.deepEqual(
      speechRangesFromProbabilities([0.6, 0.2, 0.2, 0.4, 0.2, 0.2, 0.2, 0.2], 8 * 512),
      [{ startSample: 0, endSample: 4 * 512 }],
    );
  });

  it('drops short speech and preserves multiple long-gap boundaries', () => {
    const manifest = buildVoiceActivityManifest(
      [
        { startSample: samples(40_000), endSample: samples(40_200) },
        { startSample: samples(80_000), endSample: samples(81_000) },
      ],
      samples(100_000),
    );
    assert.equal(manifest.sourceSpans[0].originalStartMs, 79_600);

    const multipleGaps = buildVoiceActivityManifest(
      [
        { startSample: samples(1_000), endSample: samples(2_000) },
        { startSample: samples(40_000), endSample: samples(41_000) },
        { startSample: samples(80_000), endSample: samples(81_000) },
      ],
      samples(82_000),
    );
    assert.equal(multipleGaps.sourceSpans.length, 3);
    assert.equal(multipleGaps.skippedIntervals.length, 2);
  });

  it('keeps gaps up to thirty seconds and collapses only longer gaps', () => {
    const exactBoundary = buildVoiceActivityManifest(
      [
        { startSample: samples(1_000), endSample: samples(2_000) },
        { startSample: samples(33_000), endSample: samples(34_000) },
      ],
      samples(35_000),
    );
    assert.equal(exactBoundary.sourceSpans.length, 1);
    assert.equal(exactBoundary.skippedIntervals.length, 0);

    const overBoundary = buildVoiceActivityManifest(
      [
        { startSample: samples(1_000), endSample: samples(2_000) },
        { startSample: samples(33_200), endSample: samples(34_000) },
      ],
      samples(35_000),
    );
    assert.equal(overBoundary.sourceSpans.length, 2);
    assert.equal(overBoundary.skippedIntervals.length, 1);
    assert.equal(
      overBoundary.sourceSpans[1].processedStartMs - overBoundary.sourceSpans[0].processedEndMs,
      2_000,
    );
  });

  it('records leading and trailing invalid audio and restores one source span', () => {
    const manifest = buildVoiceActivityManifest(
      [{ startSample: samples(40_000), endSample: samples(41_000) }],
      samples(100_000),
    );
    assert.equal(manifest.modelSha256, SILERO_VAD_MODEL_SHA256);
    assert.deepEqual(manifest.skippedIntervals, [
      { startMs: 0, endMs: 39_600, reason: 'silero_vad_non_speech' },
      { startMs: 41_600, endMs: 100_000, reason: 'silero_vad_non_speech' },
    ]);
    assert.deepEqual(
      restoreOriginalTimeline(
        [
          {
            speakerKey: 'Speaker 0',
            businessRole: 'unknown',
            emotion: 'unknown',
            startMs: 100,
            endMs: 900,
            text: '测试',
          },
        ],
        manifest,
      ).map(({ startMs, endMs }) => ({ startMs, endMs })),
      [{ startMs: 39_700, endMs: 40_500 }],
    );
  });

  it('rejects empty speech and transcript segments spanning a collapsed boundary', () => {
    assert.throws(
      () => buildVoiceActivityManifest([], samples(60_000)),
      (error) => error.code === 'NO_SPEECH_DETECTED' && error.retryable === false,
    );
    const manifest = buildVoiceActivityManifest(
      [
        { startSample: samples(1_000), endSample: samples(2_000) },
        { startSample: samples(40_000), endSample: samples(41_000) },
      ],
      samples(42_000),
    );
    assert.throws(
      () =>
        restoreOriginalTimeline(
          [
            {
              speakerKey: 'Speaker 0',
              businessRole: 'unknown',
              emotion: 'unknown',
              startMs: manifest.sourceSpans[0].processedEndMs - 100,
              endMs: manifest.sourceSpans[1].processedStartMs + 100,
              text: '跨边界',
            },
          ],
          manifest,
        ),
      (error) => error.code === 'INVALID_VAD_TIMELINE',
    );
  });

  it('loads the pinned ONNX model and rejects bounded silent PCM without fallback', async () => {
    const modelPath = new URL('../../../assets/silero-vad/v6.2.1/silero_vad.onnx', import.meta.url);
    const detector = new SileroVoiceActivityDetector(modelPath.pathname.replace(/^\/(.:)/u, '$1'));
    await detector.verify();
    await assert.rejects(
      detector.detect(
        (async function* () {
          for (let index = 0; index < 20; index += 1) yield Buffer.alloc(512 * 2);
          yield Buffer.alloc(126);
        })(),
      ),
      (error) => error.code === 'NO_SPEECH_DETECTED',
    );
  });
});
