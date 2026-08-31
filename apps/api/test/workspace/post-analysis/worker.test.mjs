/**
 * 音频后置分析 worker 测试。
 *
 * 验证初始窗口上限与无效结构触发的二分重试不会丢失目标片段。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PostAnalysisProviderError } from '../../../dist/workspace/audio/post-analysis/qwenEmotionAnalyzer.js';
import {
  AudioPostAnalysisWorker,
  buildEmotionWindows,
} from '../../../dist/workspace/audio/post-analysis/worker.js';

const makeSegment = (index, startMs = index * 1_000) => ({
  id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
  speakerKey: `Speaker ${index % 2}`,
  startMs,
  endMs: startMs + 900,
  text: `片段 ${index}`,
});

describe('AudioPostAnalysisWorker', () => {
  it('caps initial windows at fifty target segments', () => {
    const windows = buildEmotionWindows(
      Array.from({ length: 51 }, (_, index) => makeSegment(index)),
    );
    assert.deepEqual(
      windows.map((window) => window.length),
      [50, 1],
    );
  });

  it('bisects invalid model output and atomically publishes every segment', async () => {
    const segments = [makeSegment(0), makeSegment(1), makeSegment(2), makeSegment(3)];
    let claimed = false;
    let published;
    const repository = {
      resetInterrupted: async () => {},
      claim: async () => {
        if (claimed) return undefined;
        claimed = true;
        return {
          id: 'aaaaaaaa-1111-4111-8111-111111111111',
          type: 'emotion',
          model: 'qwen3.5-omni-flash',
          audioFileId: 'bbbbbbbb-1111-4111-8111-111111111111',
          revisionId: 'cccccccc-1111-4111-8111-111111111111',
          storageKey: 'audio.mp3',
          durationMs: 10_000,
          customBusinessRoles: [],
          segments,
        };
      },
      updateProgress: async () => {},
      publishEmotion: async (_job, results) => {
        published = results;
      },
      fail: async (_jobId, _code, message) => {
        throw new Error(message);
      },
    };
    const worker = new AudioPostAnalysisWorker({
      type: 'emotion',
      repository,
      preprocessor: {
        createWindow: async ({ windowIndex }) => `window-${windowIndex}.mp3`,
        cleanup: async () => {},
      },
      ossStaging: {
        uploadEmotionWindow: async (_job, path) => path,
        signedGetUrl: (key) => `https://oss.test/${key}`,
        delete: async () => {},
      },
      emotionAnalyzer: {
        analyze: async (_url, targets) => {
          if (targets.length > 1)
            throw new PostAnalysisProviderError('INVALID_MODEL_OUTPUT', 'bad', true);
          return targets.map(({ id }) => ({
            segmentId: id,
            label: 'neutral',
            confidence: 0.8,
            attitude: 'neutral',
            arousal: 'medium',
            pace: 'normal',
            volumeTrend: 'normal',
            pitchVariation: 'medium',
            pausePattern: 'normal',
            vocalCues: [],
            model: 'qwen3.5-omni-flash',
          }));
        },
      },
    });
    await worker.start();
    for (let attempt = 0; attempt < 50 && !published; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await worker.stop();
    assert.deepEqual(
      published.map(({ segmentId }) => segmentId),
      segments.map(({ id }) => id),
    );
  });
});
