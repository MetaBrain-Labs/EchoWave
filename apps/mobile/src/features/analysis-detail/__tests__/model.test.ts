/**
 * 分析详情展示模型测试。
 *
 * 验证服务端无效音频区间按原时间轴插入相邻转写片段，而不是汇总成单个提示。
 *
 * Responsibilities:
 * - 覆盖开头、片段之间、场景之间和结尾的时间轴锚点。
 *
 * Notes:
 * - 只验证移动端展示模型，不改变共享网络契约。
 */
import { analysisFixture } from '@/test/workspaceFixtures';
import { toAnalysisDetailView } from '../model';

describe('toAnalysisDetailView invalid audio timeline', () => {
  it('preserves every interval and places cross-scene gaps after the previous segment', () => {
    const firstSegment = {
      ...analysisFixture.scenes[0].segments[0],
      startMs: 35_000,
      endMs: 45_000,
    };
    const secondSegment = {
      ...analysisFixture.scenes[0].segments[1],
      startMs: 95_000,
      endMs: 105_000,
    };
    const thirdSegment = {
      ...analysisFixture.scenes[0].segments[0],
      id: '70000000-0000-4000-8000-000000000003',
      index: 1,
      startMs: 155_000,
      endMs: 165_000,
    };
    const detail = toAnalysisDetailView({
      ...analysisFixture,
      invalidSegments: [
        {
          id: 'a0000000-0000-4000-8000-000000000004',
          startMs: 165_000,
          endMs: 200_000,
          reason: 'silero_vad_non_speech',
        },
        {
          id: 'a0000000-0000-4000-8000-000000000001',
          startMs: 0,
          endMs: 35_000,
          reason: 'silero_vad_non_speech',
        },
        {
          id: 'a0000000-0000-4000-8000-000000000002',
          startMs: 45_000,
          endMs: 95_000,
          reason: 'silero_vad_non_speech',
        },
        {
          id: 'a0000000-0000-4000-8000-000000000003',
          startMs: 105_000,
          endMs: 155_000,
          reason: 'silero_vad_non_speech',
        },
      ],
      scenes: [
        {
          ...analysisFixture.scenes[0],
          segments: [firstSegment, secondSegment],
        },
        {
          ...analysisFixture.scenes[0],
          id: '60000000-0000-4000-8000-000000000002',
          index: 2,
          title: '第二场景',
          startMs: 155_000,
          segments: [thirdSegment],
        },
      ],
    });

    expect(detail.invalidSegments.map(({ durationSeconds }) => durationSeconds)).toEqual([
      35, 50, 50, 35,
    ]);
    expect(detail.scenes[0].timelineItems.map(({ id }) => id)).toEqual([
      'a0000000-0000-4000-8000-000000000001',
      firstSegment.id,
      'a0000000-0000-4000-8000-000000000002',
      secondSegment.id,
      'a0000000-0000-4000-8000-000000000003',
    ]);
    expect(detail.scenes[1].timelineItems.map(({ id }) => id)).toEqual([
      thirdSegment.id,
      'a0000000-0000-4000-8000-000000000004',
    ]);
  });
});
