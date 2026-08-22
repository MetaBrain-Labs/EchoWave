/**
 * 分析详情页面展示模型。
 *
 * 将服务端毫秒时间轴和可空 AI 标签转换为现有播放器、转写和摘要组件使用的结构。
 *
 * Responsibilities:
 * - 统一时间单位并保留场景、片段和标签顺序。
 * - 隔离网络契约与页面局部交互类型。
 *
 * Notes:
 * - 不包含任何演示记录或设备持久化状态。
 */
import type { AudioAnalysisDetail } from '@echowave/contracts';

export type AiTagAnalysis = {
  title: string;
  summary: string;
  details: readonly string[];
};

export type TranscriptSegment = {
  aiTag?: AiTagAnalysis;
  emotion: string;
  endSeconds: number;
  id: string;
  speaker: 'host' | 'self';
  speakerLabel: string;
  startSeconds: number;
  text: string;
};

export type TranscriptScene = {
  id: string;
  segments: readonly TranscriptSegment[];
  startSeconds: number;
  title: string;
};

export type SummarySection = {
  body: string;
  id: string;
  title: string;
};

export type AnalysisDetailView = {
  durationSeconds: number;
  generatedAt: string;
  id: string;
  invalidSegment?: { durationSeconds: number; startSeconds: number };
  scenes: readonly TranscriptScene[];
  summarySections: readonly SummarySection[];
  title: string;
};

/** 将服务端当前分析修订版转换为页面展示模型。 */
export function toAnalysisDetailView(detail: AudioAnalysisDetail): AnalysisDetailView {
  const invalid = detail.invalidSegments[0];
  return {
    id: detail.audioFileId,
    title: detail.title,
    durationSeconds: detail.durationMs / 1_000,
    generatedAt: new Date(detail.generatedAt).toLocaleString(),
    invalidSegment: invalid
      ? {
          startSeconds: invalid.startMs / 1_000,
          durationSeconds: (invalid.endMs - invalid.startMs) / 1_000,
        }
      : undefined,
    scenes: detail.scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      startSeconds: scene.startMs / 1_000,
      segments: scene.segments.map((segment) => ({
        id: segment.id,
        speaker: segment.speakerKey === 'self' ? 'self' : 'host',
        speakerLabel: segment.speakerLabel,
        emotion: segment.emotion,
        startSeconds: segment.startMs / 1_000,
        endSeconds: segment.endMs / 1_000,
        text: segment.text,
        aiTag: segment.aiTag
          ? {
              title: segment.aiTag.title,
              summary: segment.aiTag.summary,
              details: segment.aiTag.details,
            }
          : undefined,
      })),
    })),
    summarySections: detail.summarySections.map((section) => ({
      id: section.id,
      title: section.title,
      body: section.body,
    })),
  };
}
