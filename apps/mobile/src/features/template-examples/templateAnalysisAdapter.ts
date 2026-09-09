/**
 * 模板示例分析展示适配器。
 *
 * 将代码维护的 TemplateExample 转换为分析详情公共骨架使用的只读展示模型。
 *
 * Responsibilities:
 * - 保留模板的时间戳、角色、情绪、标签证据、摘要、建议和限制。
 * - 生成稳定的模板内部 ID，避免把示例伪装成业务音频或任务。
 *
 * Notes:
 * - 适配结果只存在于内存中，不触发 API、数据库或业务写入。
 */
import type {
  AudioBusinessAnalysisState,
  AudioPostAnalysisState,
  AudioTranscriptConfirmationState,
  AudioTranscriptionMetadata,
  SpeakerReview,
  SupportedLanguage,
  TemplateExample,
} from '@echowave/contracts';

import { translateTextForLanguage } from '@/shared/i18n/LanguageProvider';
import type {
  AiTagAnalysis,
  AnalysisDetailView,
  TranscriptScene,
  TranscriptSegment,
} from '@/features/analysis-detail/model';

function stableId(templateKey: string, kind: string, id: string): string {
  return `template:${templateKey}:${kind}:${id}`;
}

function mapTagCategory(
  kind: TemplateExample['analysisTags'][number]['kind'],
): AiTagAnalysis['category'] {
  return kind === 'action' ? 'suggestion' : kind;
}

function createTranscriptionMetadata(
  example: TemplateExample,
  language: SupportedLanguage,
): AudioTranscriptionMetadata {
  return {
    model: 'template-example',
    language,
    diarizationStatus: example.roles.length > 1 ? 'observed' : 'not_returned',
    responseGranularity: 'segment',
    segmentationMode: 'readable',
    speakerIdentityScope: 'recording',
    preprocessingMode: 'whole_file',
    expectedSpeakerCount: example.roles.length > 1 ? example.roles.length : null,
  };
}

function createConfirmationState(): AudioTranscriptConfirmationState {
  return {
    status: 'confirmed',
    currentVersion: 1,
    confirmedAt: '1970-01-01T00:00:00.000Z',
    origin: 'system_raw_snapshot',
  };
}

function createPostAnalysisState(): AudioPostAnalysisState {
  return { state: 'idle' };
}

function createBusinessAnalysisState(language: SupportedLanguage): AudioBusinessAnalysisState {
  return {
    state: 'idle',
    groupId: null,
    jobId: null,
    model: null,
    progress: 0,
    confirmationVersion: null,
    language,
    settingsCurrent: false,
    knowledgeCurrent: false,
    error: null,
    result: null,
  };
}

function createSpeakerReview(): SpeakerReview {
  return {
    status: 'ready',
    model: null,
    message: null,
    resolvedAt: null,
    findings: [],
  };
}

/** 将模板示例映射为分析详情公共展示模型。 */
export function toTemplateAnalysisView(
  example: TemplateExample,
  language: SupportedLanguage,
): AnalysisDetailView {
  const segmentIds = new Map(
    example.transcript.map((segment) => [
      segment.id,
      stableId(example.templateKey, 'segment', segment.id),
    ]),
  );
  const mapTag = (tag: TemplateExample['analysisTags'][number], index: number): AiTagAnalysis => ({
    id: stableId(example.templateKey, 'tag', `${tag.kind}:${index}`),
    category: mapTagCategory(tag.kind),
    title: tag.title,
    summary: tag.detail,
    details: [
      tag.detail,
      translateTextForLanguage(language, 'templateExample.evidence', {
        ids: tag.evidenceSegmentIds.join(language === 'zh-CN' ? '、' : ', '),
      }),
    ],
    confidence: 100,
    evidenceSegmentIds: tag.evidenceSegmentIds.map(
      (segmentId) =>
        segmentIds.get(segmentId) ?? stableId(example.templateKey, 'segment', segmentId),
    ),
    citations: [],
  });
  const tags = example.analysisTags.map(mapTag);
  const segments: TranscriptSegment[] = example.transcript.map((segment) => ({
    id: segmentIds.get(segment.id)!,
    sourceSegmentId: segmentIds.get(segment.id)!,
    speakerKey: segment.roleId,
    speakerLabel: segment.roleLabel,
    businessRole: segment.roleLabel,
    emotion: segment.emotion,
    startSeconds: segment.startMs / 1_000,
    endSeconds: segment.endMs / 1_000,
    startWordIndex: 0,
    endWordIndex: 1,
    rawText: segment.text,
    confirmedText: segment.text,
    text: segment.text,
    words: [],
    reviewFindings: [],
    aiTags: tags.filter((tag) => tag.evidenceSegmentIds.includes(segmentIds.get(segment.id)!)),
  }));
  const scene: TranscriptScene = {
    id: stableId(example.templateKey, 'scene', String(example.exampleVersion)),
    title: example.scenario,
    startSeconds: segments[0]?.startSeconds ?? 0,
    segments,
    timelineItems: segments.map((segment) => ({ id: segment.id, kind: 'segment', segment })),
  };
  const durationSeconds = example.transcript.reduce(
    (duration, segment) => Math.max(duration, segment.endMs / 1_000),
    0,
  );

  return {
    id: stableId(example.templateKey, 'example', String(example.exampleVersion)),
    revisionId: stableId(example.templateKey, 'revision', String(example.exampleVersion)),
    title: example.title,
    durationSeconds,
    generatedAt: '',
    transcription: createTranscriptionMetadata(example, language),
    speakerReview: createSpeakerReview(),
    transcriptConfirmation: createConfirmationState(),
    postAnalysis: { emotion: createPostAnalysisState(), role: createPostAnalysisState() },
    businessAnalysis: createBusinessAnalysisState(language),
    runtimeMode: 'hybrid',
    sourceState: 'missing',
    sourceRecoveryState: 'not_required',
    sourceDeleteAfter: null,
    invalidSegments: [],
    scenes: [scene],
    rawScenes: [scene],
    summarySections: example.summarySections.map((section, index) => ({
      id: stableId(example.templateKey, 'summary', `${index}:${section.title}`),
      title: section.title,
      body: section.body,
    })),
  };
}
