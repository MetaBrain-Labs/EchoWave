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
import type {
  AudioAnalysisDetail,
  AudioRuntimeMode,
  AudioPostAnalysisState,
  AudioSourceRecoveryState,
  AudioSourceState,
  AudioBusinessAnalysisState,
  BusinessAnalysisCitation,
  BusinessAnalysisTagCategory,
  AudioTranscriptionMetadata,
  AudioTranscriptConfirmationState,
  SpeakerReview,
  SpeakerReviewFinding,
  SegmentEmotionAnalysis,
  SegmentRoleAnalysis,
  TranscriptWord,
} from '@echowave/contracts';

export type AiTagAnalysis = {
  id: string;
  category: BusinessAnalysisTagCategory;
  customLabel?: string;
  title: string;
  summary: string;
  details: readonly string[];
  confidence: number;
  evidenceSegmentIds: readonly string[];
  citations: readonly BusinessAnalysisCitation[];
};

export type TranscriptSegment = {
  aiTags: readonly AiTagAnalysis[];
  businessRole: string;
  emotion: string;
  emotionAnalysis?: SegmentEmotionAnalysis;
  endSeconds: number;
  id: string;
  sourceSegmentId: string;
  speakerKey: string;
  speakerLabel: string;
  roleAnalysis?: SegmentRoleAnalysis;
  rawText: string;
  confirmedText?: string;
  startSeconds: number;
  startWordIndex: number;
  endWordIndex: number;
  text: string;
  words: readonly TranscriptWord[];
  reviewFindings: readonly SpeakerReviewFinding[];
};

export type TranscriptInvalidSegment = {
  durationSeconds: number;
  endSeconds: number;
  id: string;
  startSeconds: number;
};

export type TranscriptTimelineItem =
  | { id: string; kind: 'invalid'; invalidSegment: TranscriptInvalidSegment }
  | { id: string; kind: 'segment'; segment: TranscriptSegment };

export type TranscriptScene = {
  id: string;
  segments: readonly TranscriptSegment[];
  startSeconds: number;
  timelineItems: readonly TranscriptTimelineItem[];
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
  revisionId: string;
  invalidSegments: readonly TranscriptInvalidSegment[];
  scenes: readonly TranscriptScene[];
  rawScenes: readonly TranscriptScene[];
  summarySections: readonly SummarySection[];
  title: string;
  transcription: AudioTranscriptionMetadata;
  speakerReview: SpeakerReview;
  transcriptConfirmation: AudioTranscriptConfirmationState;
  postAnalysis: { emotion: AudioPostAnalysisState; role: AudioPostAnalysisState };
  businessAnalysis: AudioBusinessAnalysisState;
  runtimeMode: AudioRuntimeMode;
  sourceState: AudioSourceState;
  sourceRecoveryState: AudioSourceRecoveryState;
  sourceDeleteAfter: string | null;
};

type TranscriptSceneDraft = Omit<TranscriptScene, 'timelineItems'>;

function appendInvalidSegment(
  buckets: Map<string, TranscriptInvalidSegment[]>,
  key: string,
  invalidSegment: TranscriptInvalidSegment,
): void {
  const existing = buckets.get(key);
  if (existing) existing.push(invalidSegment);
  else buckets.set(key, [invalidSegment]);
}

function attachTimelineItems(
  scenes: readonly TranscriptSceneDraft[],
  invalidSegments: readonly TranscriptInvalidSegment[],
): TranscriptScene[] {
  const segmentLocations = scenes.flatMap((scene, sceneIndex) =>
    scene.segments.map((segment) => ({ sceneIndex, segment })),
  );
  const buckets = new Map<string, TranscriptInvalidSegment[]>();

  for (const invalidSegment of invalidSegments) {
    const previous = segmentLocations.findLast(
      ({ segment }) => segment.endSeconds <= invalidSegment.startSeconds,
    );
    const next = segmentLocations.find(
      ({ segment }) => segment.startSeconds >= invalidSegment.endSeconds,
    );

    if (previous) {
      appendInvalidSegment(buckets, `after:${previous.segment.id}`, invalidSegment);
    } else if (next) {
      appendInvalidSegment(buckets, `before:${next.sceneIndex}`, invalidSegment);
    } else if (segmentLocations.length > 0) {
      appendInvalidSegment(buckets, `after:${segmentLocations.at(-1)!.segment.id}`, invalidSegment);
    } else if (scenes.length > 0) {
      appendInvalidSegment(buckets, 'before:0', invalidSegment);
    }
  }

  return scenes.map((scene, sceneIndex) => ({
    ...scene,
    timelineItems: [
      ...(buckets.get(`before:${sceneIndex}`) ?? []).map(
        (invalidSegment): TranscriptTimelineItem => ({
          id: invalidSegment.id,
          kind: 'invalid',
          invalidSegment,
        }),
      ),
      ...scene.segments.flatMap((segment): TranscriptTimelineItem[] => [
        { id: segment.id, kind: 'segment', segment },
        ...(buckets.get(`after:${segment.id}`) ?? []).map((invalidSegment) => ({
          id: invalidSegment.id,
          kind: 'invalid' as const,
          invalidSegment,
        })),
      ]),
    ],
  }));
}

/** 将服务端当前分析修订版转换为页面展示模型。 */
export function toAnalysisDetailView(detail: AudioAnalysisDetail): AnalysisDetailView {
  const businessTags: AiTagAnalysis[] = (detail.businessAnalysis.result?.tags ?? []).map((tag) => ({
    id: tag.id,
    category: tag.category,
    customLabel: tag.customLabel ?? undefined,
    title: tag.title,
    summary: tag.summary,
    details: tag.details,
    confidence: tag.confidence,
    evidenceSegmentIds: tag.evidenceSegmentIds,
    citations: tag.citations,
  }));
  const invalidSegments = [...detail.invalidSegments]
    .sort((left, right) => left.startMs - right.startMs)
    .map((interval) => ({
      id: interval.id,
      startSeconds: interval.startMs / 1_000,
      endSeconds: interval.endMs / 1_000,
      durationSeconds: Math.round((interval.endMs - interval.startMs) / 1_000),
    }));
  const mapScenes = (sourceScenes: typeof detail.scenes): TranscriptSceneDraft[] =>
    [...sourceScenes]
      .sort((left, right) => left.startMs - right.startMs || left.index - right.index)
      .map((scene) => ({
        id: scene.id,
        title: scene.title,
        startSeconds: scene.startMs / 1_000,
        segments: [...scene.segments]
          .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
          .map((segment) => ({
            id: segment.id,
            sourceSegmentId: segment.sourceSegmentId ?? segment.id,
            speakerKey: segment.speakerKey,
            speakerLabel: segment.speakerLabel,
            businessRole: segment.businessRole,
            emotion: segment.emotion,
            roleAnalysis: segment.roleAnalysis ?? undefined,
            emotionAnalysis: segment.emotionAnalysis ?? undefined,
            startSeconds: segment.startMs / 1_000,
            startWordIndex: segment.startWordIndex,
            endWordIndex: segment.endWordIndex ?? Math.max(segment.words.length, 1),
            endSeconds: segment.endMs / 1_000,
            rawText: segment.rawText,
            confirmedText: segment.confirmedText ?? undefined,
            text: segment.confirmedText ?? segment.rawText,
            words: segment.words,
            reviewFindings: segment.reviewFindings,
            aiTags: [
              ...businessTags.filter((tag) => tag.evidenceSegmentIds.includes(segment.id)),
              ...(businessTags.length === 0 && segment.aiTag
                ? [
                    {
                      id: segment.aiTag.id,
                      category: 'custom' as const,
                      customLabel: segment.aiTag.title,
                      title: segment.aiTag.title,
                      summary: segment.aiTag.summary,
                      details: segment.aiTag.details,
                      confidence: 100,
                      evidenceSegmentIds: [segment.id],
                      citations: [],
                    },
                  ]
                : []),
            ],
          })),
      }));
  const scenes = mapScenes(detail.scenes);
  const rawScenes = mapScenes(detail.rawScenes.length > 0 ? detail.rawScenes : detail.scenes);
  return {
    id: detail.audioFileId,
    revisionId: detail.id,
    title: detail.title,
    durationSeconds: detail.durationMs / 1_000,
    generatedAt: new Date(
      detail.businessAnalysis.result?.generatedAt ?? detail.generatedAt,
    ).toLocaleString(),
    transcription: detail.transcription,
    speakerReview: detail.speakerReview,
    transcriptConfirmation: detail.transcriptConfirmation,
    postAnalysis: detail.postAnalysis,
    businessAnalysis: detail.businessAnalysis,
    runtimeMode: detail.runtimeMode,
    sourceState: detail.sourceState,
    sourceRecoveryState: detail.sourceRecoveryState,
    sourceDeleteAfter: detail.sourceDeleteAfter,
    invalidSegments,
    scenes: attachTimelineItems(scenes, invalidSegments),
    rawScenes: attachTimelineItems(rawScenes, invalidSegments),
    summarySections: (
      detail.businessAnalysis.result?.summarySections ?? detail.summarySections
    ).map((section) => ({
      id: section.id,
      title: section.title,
      body: section.body,
    })),
  };
}
