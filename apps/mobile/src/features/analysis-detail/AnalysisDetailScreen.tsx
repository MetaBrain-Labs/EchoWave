/**
 * 分析详情页面编排器。
 *
 * 持有播放器、标签页、选中片段与用户偏好状态，并组合职责明确的展示组件。
 *
 * Responsibilities:
 * - 协调转写、总结、播放器和 AI 标签面板的状态转换。
 * - 处理页面返回、分页与不存在记录的降级展示。
 *
 * Notes:
 * - 只展示服务端已经原子发布的当前分析修订版。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type {
  AudioAiExecutionTraceResponse,
  AudioAnalysisStatusStreamEvent,
  AudioPostAnalysisType,
  AudioTranscriptionRunListResponse,
  SupportedLanguage,
} from '@echowave/contracts';
import { DEFAULT_AUDIO_TRANSCRIPTION_MODEL } from '@echowave/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAudioPlayback } from '@/shared/audio/useAudioPlayback';
import { streamAudioExecutionTrace } from '@/shared/api/audioExecutionStream';
import { streamAudioAnalysisStatus } from '@/shared/api/liveUpdateStreams';
import { pickDocumentAsync } from '@/shared/files/documentPicker';
import {
  confirmAudioTranscript,
  getAudioAnalysis,
  getAudioExecutionTrace,
  listAudioTranscriptions,
  resolveAllSpeakerReviewFindings,
  resolveSpeakerReviewFinding,
  remountAudioSource,
  startAudioBusinessAnalysis,
  startAudioEmotionAnalysis,
  startAudioRoleRecognition,
  startAudioTranscription,
  selectAudioTranscription,
} from '@/shared/api/audioAnalysisApi';
import { getGroupSettings } from '@/shared/api/groupsApi';
import { WorkspaceRequestError } from '@/shared/api/request';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { localizeRequestError } from '@/shared/i18n/errorLocalization';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { applyExecutionTraceEvent, hasRunningExecution } from './executionTraceState';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import {
  toAnalysisDetailView,
  type AiTagAnalysis,
  type AnalysisDetailView,
  type TranscriptSegment,
} from './model';
import {
  getHideIrrelevantSegmentsPreference,
  setHideIrrelevantSegmentsPreference,
} from './preferences';
import { IconButton } from './components/AnalysisControls';
import { type AnalysisTab } from './components/AnalysisTabs';
import {
  AnalysisDetailCanvas,
  AnalysisSourceUnavailableCard,
} from './components/AnalysisDetailCanvas';
import { CompactPlayer, ExpandedPlayer } from './components/Player';
import { type TranscriptDisplayMode } from './components/TranscriptContent';
import { EmotionAnalysisPanel } from './components/EmotionAnalysisPanel';
import { ModelExecutionContent } from './components/ModelExecutionContent';
import { PostAnalysisConfirmDialog, PostAnalysisControls } from './components/PostAnalysisControls';
import { TranscriptionRunSelector } from './components/TranscriptionRunSelector';
import {
  BusinessAnalysisControls,
  BusinessAnalysisPreflightDialog,
} from './components/BusinessAnalysisControls';

const playbackRates = [1, 1.5, 2] as const;

function transcriptDraftSignature(segments: readonly TranscriptSegment[]): string {
  return JSON.stringify(
    segments.map((segment) => ({
      sourceSegmentId: segment.sourceSegmentId,
      startWordIndex: segment.startWordIndex,
      endWordIndex: segment.endWordIndex,
      speakerKey: segment.speakerKey,
      text: segment.text,
    })),
  );
}

function wordsToText(segment: TranscriptSegment, start: number, end: number): string {
  return segment.words
    .filter((word) => word.index >= start && word.index < end)
    .map((word) => `${word.text}${word.punctuation}`)
    .join('');
}

function nextSpeakerKey(segments: readonly TranscriptSegment[]): string {
  const maximum = segments.reduce((value, segment) => {
    const match = /^Speaker (\d+)$/.exec(segment.speakerKey);
    return Math.max(value, match ? Number(match[1]) : 0);
  }, 0);
  return `Speaker ${maximum + 1}`;
}

function withoutResolvedSpeakerFindings(
  detail: AnalysisDetailView,
  resolvedIds?: ReadonlySet<string>,
): AnalysisDetailView {
  const keepFinding = (finding: { id: string }) =>
    resolvedIds ? !resolvedIds.has(finding.id) : false;
  const findings = detail.speakerReview.findings.filter(keepFinding);
  const hasPendingBoundary = findings.some(
    (finding) => finding.sourceSegmentId !== null && finding.splitAfterWordIndex !== null,
  );
  const mapScenes = (scenes: readonly AnalysisDetailView['scenes'][number][]) =>
    scenes.map((scene) => {
      const segments = scene.segments.map((segment) => ({
        ...segment,
        reviewFindings: segment.reviewFindings.filter(keepFinding),
      }));
      const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));
      return {
        ...scene,
        segments,
        timelineItems: scene.timelineItems.map((item) =>
          item.kind === 'segment'
            ? { ...item, segment: segmentsById.get(item.segment.id) ?? item.segment }
            : item,
        ),
      };
    });
  return {
    ...detail,
    speakerReview: {
      ...detail.speakerReview,
      findings,
      resolvedAt: hasPendingBoundary ? null : new Date().toISOString(),
    },
    scenes: mapScenes(detail.scenes),
    rawScenes: mapScenes(detail.rawScenes),
  };
}

type AudioAnalysisStatusPayload = Extract<
  AudioAnalysisStatusStreamEvent,
  { type: 'snapshot' | 'analysis-status' }
>;
type AudioAnalysisLiveState = AudioAnalysisStatusPayload['state'];

function isPostAnalysisActive(state: AudioAnalysisLiveState['emotion']): boolean {
  return state.state === 'queued' || state.state === 'running';
}

function hasActiveLiveAnalysis(state: AudioAnalysisLiveState): boolean {
  return (
    isPostAnalysisActive(state.emotion) ||
    isPostAnalysisActive(state.role) ||
    state.business.state === 'queued' ||
    state.business.state === 'running'
  );
}

function hasConvergedToTerminalState(
  current: AnalysisDetailView,
  expected: AudioAnalysisLiveState,
): boolean {
  const postAnalysisConverged = (type: 'emotion' | 'role') => {
    const expectedState = expected[type];
    if (
      isPostAnalysisActive(expectedState) ||
      expectedState.state === 'idle' ||
      expectedState.state === 'not_requested' ||
      expectedState.state === 'source_unavailable'
    )
      return true;
    const currentState = current.postAnalysis[type];
    return currentState.state === expectedState.state && currentState.jobId === expectedState.jobId;
  };
  const businessConverged = (() => {
    if (
      expected.business.state === 'queued' ||
      expected.business.state === 'running' ||
      expected.business.state === 'idle'
    ) {
      return true;
    }
    if (
      current.businessAnalysis.state !== expected.business.state ||
      current.businessAnalysis.jobId !== expected.business.jobId
    ) {
      return false;
    }
    return (
      expected.business.state !== 'ready' ||
      current.businessAnalysis.result?.jobId === expected.business.jobId
    );
  })();
  return postAnalysisConverged('emotion') && postAnalysisConverged('role') && businessConverged;
}

type AnalysisDetailScreenProps = {
  detailId: string;
  groupId?: string;
  onBack: () => void;
  onOpenCitation?: (knowledgeBaseId: string, documentId: string, chunkId: string) => void;
};

/** 渲染指定分析记录的转写、摘要和交互式播放展示。 */
export function AnalysisDetailScreen({
  detailId,
  groupId,
  onBack,
  onOpenCitation,
}: AnalysisDetailScreenProps) {
  const { language: appLanguage, t } = useAppLanguage();
  const [detail, setDetail] = useState<AnalysisDetailView>();
  const [transcriptionRuns, setTranscriptionRuns] = useState<AudioTranscriptionRunListResponse>();
  const [selectingTranscription, setSelectingTranscription] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [executionTrace, setExecutionTrace] = useState<AudioAiExecutionTraceResponse>();
  const [executionTraceLoading, setExecutionTraceLoading] = useState(false);
  const [executionTraceScope, setExecutionTraceScope] = useState('');
  const [executionTraceError, setExecutionTraceError] = useState('');
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  const executionCursorRef = useRef('');
  const executionTraceRef = useRef<AudioAiExecutionTraceResponse | undefined>(undefined);
  const executionScopeRef = useRef('');
  const detailRequestSequenceRef = useRef(0);
  const [activeTab, setActiveTab] = useState<AnalysisTab>('transcript');
  const [expandedPlayer, setExpandedPlayer] = useState(false);
  const [playbackRateIndex, setPlaybackRateIndex] = useState(0);
  const [selectedTag, setSelectedTag] = useState<AiTagAnalysis>();
  const [emotionSegment, setEmotionSegment] = useState<TranscriptSegment>();
  const [confirmAnalysisType, setConfirmAnalysisType] = useState<AudioPostAnalysisType>();
  const [analysisLanguage, setAnalysisLanguage] = useState<SupportedLanguage>(appLanguage);
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [confirmingTranscript, setConfirmingTranscript] = useState(false);
  const [resolvingSpeakerReview, setResolvingSpeakerReview] = useState<string>();
  const [transcriptDisplayMode, setTranscriptDisplayMode] =
    useState<TranscriptDisplayMode>('current');
  const [transcriptDraftSegments, setTranscriptDraftSegments] = useState<TranscriptSegment[]>([]);
  const [hideIrrelevant, setHideIrrelevant] = useState(getHideIrrelevantSegmentsPreference);
  const [businessPreflightVisible, setBusinessPreflightVisible] = useState(false);
  const [businessForce, setBusinessForce] = useState(false);
  const [startingBusiness, setStartingBusiness] = useState(false);
  const [supplementingBusiness, setSupplementingBusiness] = useState(false);
  const [analysisTiming, setAnalysisTiming] = useState<'automatic' | 'manual'>('manual');
  const [preflightPrompted, setPreflightPrompted] = useState(false);
  const runInitialRequest = useInitialRequestLoading();
  const playback = useAudioPlayback(
    detail?.sourceState === 'available' ? detailId || undefined : undefined,
  );
  const changeHideIrrelevant = (value: boolean) => {
    setHideIrrelevantSegmentsPreference(value);
    setHideIrrelevant(value);
  };
  const hasSummary = Boolean(detail?.summarySections.length);
  const currentExecutionScope = `${detailId}:${detail?.revisionId ?? ''}:${groupId ?? ''}`;
  const currentExecutionTrace =
    executionTraceScope === currentExecutionScope ? executionTrace : undefined;
  useEffect(() => {
    executionScopeRef.current = currentExecutionScope;
    executionCursorRef.current = '';
    executionTraceRef.current = undefined;
  }, [currentExecutionScope]);
  const transcriptSegments = detail?.scenes.flatMap((scene) => scene.segments) ?? [];
  const transcriptDirty =
    editingTranscript &&
    transcriptDraftSignature(transcriptDraftSegments) !==
      transcriptDraftSignature(transcriptSegments);
  const applyTabChange = (tab: AnalysisTab) => {
    setActiveTab(tab);
    if (tab !== 'transcript') {
      setExpandedPlayer(false);
      setSelectedTag(undefined);
    }
  };
  const load = useCallback(
    async (showLoading = true): Promise<AnalysisDetailView | undefined> => {
      const requestSequence = ++detailRequestSequenceRef.current;
      if (showLoading) setLoading(true);
      if (showLoading) setError('');
      try {
        const [analysis, runs] = await Promise.all([
          getAudioAnalysis(detailId, groupId),
          listAudioTranscriptions(detailId).catch(() => undefined),
        ]);
        const nextDetail = toAnalysisDetailView(analysis, appLanguage);
        if (requestSequence !== detailRequestSequenceRef.current) return undefined;
        setDetail(nextDetail);
        if (runs) setTranscriptionRuns(runs);
        setError('');
        return nextDetail;
      } catch (reason) {
        if (requestSequence === detailRequestSequenceRef.current && showLoading) {
          setDetail(undefined);
          setError(reason instanceof Error ? reason.message : t('analysisDetail.loadFailed'));
        }
        return undefined;
      } finally {
        if (requestSequence === detailRequestSequenceRef.current && showLoading) setLoading(false);
      }
    },
    [appLanguage, detailId, groupId, t],
  );
  useEffect(() => {
    const task = setTimeout(() => void runInitialRequest(load), 0);
    return () => clearTimeout(task);
  }, [load, runInitialRequest]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  const loadExecutionTrace = useCallback(
    async (showLoading = true) => {
      const cursorAtStart = executionCursorRef.current;
      if (showLoading) setExecutionTraceLoading(true);
      setExecutionTraceError('');
      try {
        const nextTrace = await getAudioExecutionTrace(detailId, groupId);
        // SSE 已消费新事件时，较早发出的 REST 响应不得覆盖更新后的本地轨迹。
        if (
          executionScopeRef.current !== currentExecutionScope ||
          executionCursorRef.current !== cursorAtStart
        ) {
          return;
        }
        executionTraceRef.current = nextTrace;
        setExecutionTrace(nextTrace);
      } catch (reason) {
        if (executionScopeRef.current === currentExecutionScope) {
          setExecutionTraceError(
            reason instanceof Error ? reason.message : t('analysisDetail.traceLoadFailed'),
          );
        }
      } finally {
        if (executionScopeRef.current === currentExecutionScope) {
          setExecutionTraceScope(currentExecutionScope);
        }
        if (showLoading) setExecutionTraceLoading(false);
      }
    },
    [currentExecutionScope, detailId, groupId, t],
  );
  const refreshPage = useCallback(async () => {
    await Promise.all([
      load(false),
      groupId
        ? getGroupSettings(groupId)
            .then((settings) => setAnalysisTiming(settings.analysis.timing))
            .catch(() => undefined)
        : Promise.resolve(),
      activeTab === 'model' ? loadExecutionTrace(false) : Promise.resolve(),
    ]);
  }, [activeTab, groupId, load, loadExecutionTrace]);
  const screenRefresh = useScreenRefresh(refreshPage);
  useEffect(() => {
    if (
      activeTab !== 'model' ||
      executionTraceScope === currentExecutionScope ||
      executionTraceLoading
    ) {
      return undefined;
    }
    const task = setTimeout(() => void loadExecutionTrace(), 0);
    return () => clearTimeout(task);
  }, [
    activeTab,
    currentExecutionScope,
    executionTraceLoading,
    executionTraceScope,
    loadExecutionTrace,
  ]);
  useEffect(() => {
    if (!groupId) return undefined;
    const task = setTimeout(() => {
      void getGroupSettings(groupId)
        .then((settings) => setAnalysisTiming(settings.analysis.timing))
        .catch(() => setAnalysisTiming('manual'));
    }, 0);
    return () => clearTimeout(task);
  }, [groupId]);

  const hasActiveAnalysis =
    detail?.postAnalysis.emotion.state === 'queued' ||
    detail?.postAnalysis.emotion.state === 'running' ||
    detail?.postAnalysis.role.state === 'queued' ||
    detail?.postAnalysis.role.state === 'running' ||
    detail?.businessAnalysis.state === 'queued' ||
    detail?.businessAnalysis.state === 'running';
  useEffect(() => {
    if (!hasActiveAnalysis || !appActive) return undefined;
    let disposed = false;
    let controller: AbortController | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const retryDelays = [1_000, 2_000, 5_000, 10_000];
    const reconciliationTimers = new Set<ReturnType<typeof setTimeout>>();
    const pollTimer = setInterval(() => void load(false), 5_000);
    const waitForRetry = (delayMs: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          reconciliationTimers.delete(timer);
          resolve();
        }, delayMs);
        reconciliationTimers.add(timer);
      });
    const reconcileTerminalState = async (expected: AudioAnalysisLiveState) => {
      for (const delayMs of [0, 1_000, 2_000, 5_000]) {
        if (delayMs > 0) await waitForRetry(delayMs);
        if (disposed) return;
        const nextDetail = await load(false);
        if (
          nextDetail &&
          nextDetail.revisionId === detail?.revisionId &&
          hasConvergedToTerminalState(nextDetail, expected)
        ) {
          return;
        }
      }
    };
    const initialPollTimer = setTimeout(() => void load(false), 0);
    const connect = async () => {
      controller = new AbortController();
      try {
        await streamAudioAnalysisStatus({
          audioFileId: detailId,
          groupId,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'error') return;
            failures = 0;
            if (event.type !== 'snapshot' && event.type !== 'analysis-status') return;
            if (event.analysisRevisionId !== detail?.revisionId) return;
            if (!hasActiveLiveAnalysis(event.state)) {
              void reconcileTerminalState(event.state);
              return;
            }
            setDetail((current) =>
              current && current.revisionId === event.analysisRevisionId
                ? {
                    ...current,
                    postAnalysis: {
                      emotion: event.state.emotion,
                      role: event.state.role,
                    },
                    businessAnalysis: {
                      ...event.state.business,
                      result: current.businessAnalysis.result,
                    },
                  }
                : current,
            );
            if (event.type === 'analysis-status' && event.terminal) void load(false);
          },
        });
        if (!disposed) throw new Error('分析实时状态连接已关闭。');
      } catch {
        if (disposed || controller.signal.aborted) return;
        failures += 1;
        retryTimer = setTimeout(
          () => void connect(),
          retryDelays[Math.min(failures - 1, retryDelays.length - 1)],
        );
      }
    };
    void connect();
    return () => {
      disposed = true;
      controller?.abort();
      if (retryTimer) clearTimeout(retryTimer);
      clearTimeout(initialPollTimer);
      clearInterval(pollTimer);
      reconciliationTimers.forEach(clearTimeout);
    };
  }, [appActive, detail?.revisionId, detailId, groupId, hasActiveAnalysis, load]);
  useEffect(() => {
    if (activeTab !== 'model' || !appActive) return undefined;
    let disposed = false;
    let controller: AbortController | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    let failures = 0;
    const retryDelays = [1_000, 2_000, 5_000, 10_000];

    const stopFallback = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = undefined;
    };
    const startFallback = () => {
      if (fallbackTimer) return;
      void loadExecutionTrace(false);
      fallbackTimer = setInterval(() => void loadExecutionTrace(false), 2_000);
    };
    const connect = async () => {
      controller = new AbortController();
      try {
        await streamAudioExecutionTrace({
          audioFileId: detailId,
          groupId,
          cursor: executionCursorRef.current || undefined,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'error') {
              setExecutionTraceError(localizeRequestError(event.error.code, event.error.message));
              return;
            }
            failures = 0;
            stopFallback();
            if (event.type === 'heartbeat') {
              // 连接可能仍健康但曾遗漏终态；运行中快照必须周期性与数据库重新对齐。
              if (hasRunningExecution(executionTraceRef.current)) void loadExecutionTrace(false);
              return;
            }
            const nextTrace = applyExecutionTraceEvent(executionTraceRef.current, event);
            if (!nextTrace) {
              // 未能应用的持久化事件不能被游标越过，否则重连后不会再次收到它。
              void loadExecutionTrace(false);
              return;
            }
            executionTraceRef.current = nextTrace;
            setExecutionTrace(nextTrace);
            setExecutionTraceScope(currentExecutionScope);
            setExecutionTraceError('');
            executionCursorRef.current = event.cursor;
          },
        });
        if (!disposed) throw new Error('模型执行实时流已关闭。');
      } catch {
        if (disposed || controller.signal.aborted) return;
        failures += 1;
        if (failures >= 5) {
          setExecutionTraceError(t('analysisDetail.liveFallback'));
          startFallback();
        }
        retryTimer = setTimeout(
          () => void connect(),
          failures >= 5 ? 30_000 : retryDelays[Math.min(failures - 1, retryDelays.length - 1)],
        );
      }
    };

    void connect();
    return () => {
      disposed = true;
      controller?.abort();
      if (retryTimer) clearTimeout(retryTimer);
      stopFallback();
    };
  }, [activeTab, appActive, currentExecutionScope, detailId, groupId, loadExecutionTrace, t]);

  useEffect(() => {
    if (
      !groupId ||
      !detail ||
      preflightPrompted ||
      detail.transcriptConfirmation.status !== 'confirmed' ||
      detail.businessAnalysis.state !== 'idle'
    ) {
      return;
    }
    const task = setTimeout(() => {
      setPreflightPrompted(true);
      setBusinessForce(false);
      setAnalysisLanguage(appLanguage);
      setBusinessPreflightVisible(true);
    }, 0);
    return () => clearTimeout(task);
  }, [appLanguage, detail, groupId, preflightPrompted]);

  const requestBusinessAnalysis = (force: boolean) => {
    if (!groupId || !detail) {
      Alert.alert(t('analysisDetail.cannotStart'), t('analysisDetail.missingGroup'));
      return;
    }
    if (detail.transcriptConfirmation.status !== 'confirmed') {
      Alert.alert(t('analysisDetail.confirmFirst'), t('analysisDetail.businessConfirmedOnly'));
      setActiveTab('transcript');
      return;
    }
    setBusinessForce(force);
    setAnalysisLanguage(appLanguage);
    setBusinessPreflightVisible(true);
  };

  const continueBusinessAnalysis = async () => {
    if (!groupId || startingBusiness) return;
    setStartingBusiness(true);
    try {
      await startAudioBusinessAnalysis(detailId, {
        groupId,
        force: businessForce,
        language: analysisLanguage,
      });
      setBusinessPreflightVisible(false);
      await load(false);
    } catch (reason) {
      Alert.alert(
        t('analysisDetail.cannotStart'),
        reason instanceof Error ? reason.message : t('analysisBatch.tryAgain'),
      );
    } finally {
      setStartingBusiness(false);
    }
  };

  const supplementBusinessAnalysis = async () => {
    if (!detail || supplementingBusiness) return;
    const version = detail.transcriptConfirmation.currentVersion;
    setSupplementingBusiness(true);
    try {
      const tasks: Promise<unknown>[] = [];
      const emotion = detail.postAnalysis.emotion;
      const role = detail.postAnalysis.role;
      if (
        emotion.state === 'idle' ||
        emotion.state === 'failed' ||
        ('confirmationVersion' in emotion && emotion.confirmationVersion !== version)
      ) {
        tasks.push(startAudioEmotionAnalysis(detailId, { language: analysisLanguage }));
      }
      if (
        role.state === 'idle' ||
        role.state === 'failed' ||
        ('confirmationVersion' in role && role.confirmationVersion !== version)
      ) {
        tasks.push(startAudioRoleRecognition(detailId, { language: analysisLanguage }));
      }
      await Promise.all(tasks);
      setBusinessPreflightVisible(false);
      await load(false);
      Alert.alert(
        tasks.length > 0 ? t('analysisDetail.tasksStarted') : t('analysisDetail.tasksRunning'),
        t('analysisDetail.tasksHint'),
      );
    } catch (reason) {
      Alert.alert(
        t('analysisDetail.supplementFailed'),
        reason instanceof Error ? reason.message : t('analysisBatch.tryAgain'),
      );
    } finally {
      setSupplementingBusiness(false);
    }
  };

  const confirmPostAnalysis = async () => {
    if (!confirmAnalysisType || startingAnalysis) return;
    if (detail?.transcriptConfirmation.status !== 'confirmed') {
      Alert.alert(t('analysisDetail.confirmFirst'), t('analysisDetail.postConfirmedOnly'));
      return;
    }
    setStartingAnalysis(true);
    try {
      if (confirmAnalysisType === 'emotion')
        await startAudioEmotionAnalysis(detailId, { language: analysisLanguage });
      else await startAudioRoleRecognition(detailId, { language: analysisLanguage });
      setConfirmAnalysisType(undefined);
      await load(false);
      if (analysisTiming === 'automatic' && groupId) {
        setBusinessForce(false);
        setBusinessPreflightVisible(true);
      }
    } catch (reason) {
      Alert.alert(
        t('analysisDetail.cannotStart'),
        reason instanceof Error ? reason.message : t('analysisBatch.tryAgain'),
      );
    } finally {
      setStartingAnalysis(false);
    }
  };

  const finishTranscriptEditing = () => {
    setEditingTranscript(false);
    setConfirmingTranscript(false);
    setTranscriptDraftSegments([]);
    setTranscriptDisplayMode('current');
  };

  const reselectSourceAndTranscribe = async () => {
    try {
      const selection = await pickDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['audio/*'],
      });
      if (!selection || selection.canceled) return;
      await remountAudioSource(detailId, selection.assets[0]!);
      await startAudioTranscription(detailId, {
        model: DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
        preprocessing: 'silero_vad',
        segmentationMode: 'speaker_turn',
        includeAcousticEmotion: true,
        language: appLanguage,
      });
      Alert.alert(
        t('analysisDetail.transcriptionCreated'),
        t('analysisDetail.transcriptionQueued'),
      );
      await load(false);
    } catch (reason) {
      Alert.alert(
        t('analysisDetail.remountFailed'),
        reason instanceof Error ? reason.message : t('analysisDetail.selectOriginal'),
      );
    }
  };

  const changeTranscriptionSelection = async (
    input: { mode: 'auto' } | { mode: 'manual'; revisionId: string },
  ) => {
    if (selectingTranscription) return;
    setSelectingTranscription(true);
    try {
      setTranscriptionRuns(await selectAudioTranscription(detailId, input));
      await load(false);
    } catch (reason) {
      Alert.alert(
        t('analysisDetail.switchRunFailed'),
        reason instanceof Error ? reason.message : t('analysisBatch.tryAgain'),
      );
    } finally {
      setSelectingTranscription(false);
    }
  };

  const startTranscriptEditing = () => {
    if (!detail) return;
    setTranscriptDraftSegments(
      detail.scenes.flatMap((scene) => scene.segments.map((segment) => ({ ...segment }))),
    );
    setTranscriptDisplayMode('current');
    setEditingTranscript(true);
  };

  const cancelTranscriptEditing = () => {
    if (!transcriptDirty) {
      finishTranscriptEditing();
      return;
    }
    Alert.alert(t('analysisDetail.discardTitle'), t('analysisDetail.discardEditBody'), [
      { text: t('analysisDetail.keepEditing'), style: 'cancel' },
      { text: t('analysisDetail.discard'), style: 'destructive', onPress: finishTranscriptEditing },
    ]);
  };

  const confirmTranscript = async () => {
    if (!detail || confirmingTranscript) return;
    if (transcriptDraftSegments.some((segment) => segment.text.trim().length === 0)) {
      Alert.alert(t('analysisDetail.confirmFailed'), t('analysisDetail.emptySegment'));
      return;
    }
    const segments = detail.rawScenes
      .flatMap((scene) => scene.segments)
      .map((source) => ({
        sourceSegmentId: source.id,
        parts: transcriptDraftSegments
          .filter((segment) => segment.sourceSegmentId === source.id)
          .sort((left, right) => left.startWordIndex - right.startWordIndex)
          .map((segment) => ({
            speakerKey: segment.speakerKey,
            startWordIndex: segment.startWordIndex,
            endWordIndex: segment.endWordIndex,
            text: segment.text,
          })),
      }));
    setConfirmingTranscript(true);
    try {
      await confirmAudioTranscript(detail.id, {
        analysisRevisionId: detail.revisionId,
        baseVersion: detail.transcriptConfirmation.currentVersion,
        segments,
      });
      finishTranscriptEditing();
      await load(false);
    } catch (reason) {
      if (reason instanceof WorkspaceRequestError && reason.code === 'CONFLICT') {
        Alert.alert(t('analysisDetail.versionChanged'), reason.message, [
          { text: t('analysisDetail.keepDraft'), style: 'cancel' },
          {
            text: t('analysisDetail.reloadDiscard'),
            style: 'destructive',
            onPress: () => {
              finishTranscriptEditing();
              void load(false);
            },
          },
        ]);
      } else {
        Alert.alert(
          t('analysisDetail.confirmFailed'),
          reason instanceof Error ? reason.message : t('analysisBatch.tryAgain'),
        );
      }
    } finally {
      setConfirmingTranscript(false);
    }
  };

  const resolveOneSpeakerFinding = async (findingId: string) => {
    if (!detail || resolvingSpeakerReview) return;
    setResolvingSpeakerReview(findingId);
    try {
      await resolveSpeakerReviewFinding(detail.id, findingId);
      const resolvedIds = new Set([findingId]);
      setDetail((current) =>
        current ? withoutResolvedSpeakerFindings(current, resolvedIds) : current,
      );
      setTranscriptDraftSegments((current) =>
        current.map((segment) => ({
          ...segment,
          reviewFindings: segment.reviewFindings.filter((finding) => !resolvedIds.has(finding.id)),
        })),
      );
    } catch (reason) {
      Alert.alert(
        t('analysisDetail.reviewFailed'),
        reason instanceof Error ? reason.message : t('analysisBatch.tryAgain'),
      );
    } finally {
      setResolvingSpeakerReview(undefined);
    }
  };

  const resolveAllSpeakerFindings = async () => {
    if (!detail || resolvingSpeakerReview || detail.speakerReview.findings.length === 0) return;
    setResolvingSpeakerReview('all');
    try {
      await resolveAllSpeakerReviewFindings(detail.id);
      setDetail((current) => (current ? withoutResolvedSpeakerFindings(current) : current));
      setTranscriptDraftSegments((current) =>
        current.map((segment) => ({ ...segment, reviewFindings: [] })),
      );
    } catch (reason) {
      Alert.alert(
        t('analysisDetail.reviewAllFailed'),
        reason instanceof Error ? reason.message : t('analysisBatch.tryAgain'),
      );
    } finally {
      setResolvingSpeakerReview(undefined);
    }
  };

  const requestBack = useCallback(() => {
    if (!transcriptDirty) {
      onBack();
      return;
    }
    Alert.alert(t('analysisDetail.discardTitle'), t('analysisDetail.discardBackBody'), [
      { text: t('analysisDetail.keepEditing'), style: 'cancel' },
      { text: t('analysisDetail.discardBack'), style: 'destructive', onPress: onBack },
    ]);
  }, [onBack, t, transcriptDirty]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedTag) {
        setSelectedTag(undefined);
        return true;
      }
      if (transcriptDirty) {
        requestBack();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [requestBack, selectedTag, transcriptDirty]);

  if (loading) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.unknownTopBar}>
          <IconButton icon="chevron-back" label={t('common.back')} onPress={requestBack} />
        </View>
        <ActivityIndicator
          accessibilityLabel={t('analysisDetail.loading')}
          color={colors.ink}
          style={styles.loading}
        />
      </SafeAreaView>
    );
  }

  if (!detail) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.unknownTopBar}>
          <IconButton icon="chevron-back" label={t('common.back')} onPress={requestBack} />
        </View>
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.emptyState}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        >
          <Ionicons color={colors.secondary} name="document-outline" size={36} />
          <Text style={styles.emptyTitle}>{t('analysisDetail.notFound')}</Text>
          <Text accessibilityRole="alert" style={styles.emptyDescription}>
            {error || t('analysisDetail.notFoundHint')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={({ pressed }) => [styles.returnButton, pressed && styles.pressed]}
          >
            <Text style={styles.returnButtonText}>{t('analysisDetail.reload')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={requestBack}
            style={({ pressed }) => [styles.returnButton, pressed && styles.pressed]}
          >
            <Text style={styles.returnButtonText}>{t('analysisDetail.backGroups')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const sourceAvailable = detail.sourceState === 'available';
  const playbackRate = playbackRates[playbackRateIndex];
  const playbackDuration = playback.duration > 0 ? playback.duration : detail.durationSeconds;
  const changePlaybackRate = () => {
    setPlaybackRateIndex((index) => {
      const nextIndex = (index + 1) % playbackRates.length;
      playback.setPlaybackRate(playbackRates[nextIndex]);
      return nextIndex;
    });
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <AnalysisDetailCanvas
        activeTab={activeTab}
        audioExpanded={expandedPlayer}
        detail={detail}
        hideIrrelevant={hideIrrelevant}
        modelContent={
          <ModelExecutionContent
            error={executionTraceError}
            loading={executionTraceLoading}
            onRefresh={screenRefresh.onRefresh}
            onRetry={() => void loadExecutionTrace()}
            refreshing={screenRefresh.refreshing}
            trace={currentExecutionTrace}
          />
        }
        onChangeTab={applyTabChange}
        onCloseTag={() => setSelectedTag(undefined)}
        onHideIrrelevantChange={changeHideIrrelevant}
        onOpenCitation={(knowledgeBaseId, documentId, chunkId) => {
          setSelectedTag(undefined);
          onOpenCitation?.(knowledgeBaseId, documentId, chunkId);
        }}
        selectedTag={selectedTag}
        summary={hasSummary ? screenRefresh : undefined}
        tasksContent={
          <ScrollView
            alwaysBounceVertical
            contentContainerStyle={styles.tasksContent}
            nestedScrollEnabled
            refreshControl={<ScreenRefreshControl {...screenRefresh} />}
            showsVerticalScrollIndicator={false}
            testID="analysis-tasks-scroll"
          >
            <TranscriptionRunSelector
              onAuto={() => void changeTranscriptionSelection({ mode: 'auto' })}
              onSelect={(revisionId) =>
                void changeTranscriptionSelection({ mode: 'manual', revisionId })
              }
              pending={selectingTranscription}
              runs={transcriptionRuns}
            />
            <PostAnalysisControls
              confirmed={detail.transcriptConfirmation.status === 'confirmed'}
              emotion={detail.postAnalysis.emotion}
              onRemountSource={() => void reselectSourceAndTranscribe()}
              onStart={(type) => {
                setAnalysisLanguage(appLanguage);
                setConfirmAnalysisType(type);
              }}
              role={detail.postAnalysis.role}
              runtimeMode={detail.runtimeMode}
            />
            {groupId ? (
              <BusinessAnalysisControls
                onStart={requestBusinessAnalysis}
                state={detail.businessAnalysis}
              />
            ) : null}
          </ScrollView>
        }
        tagSegments={transcriptSegments}
        topContent={
          sourceAvailable ? (
            expandedPlayer ? (
              <ExpandedPlayer
                durationSeconds={playbackDuration}
                error={playback.error}
                isBuffering={playback.isBuffering}
                isLoaded={playback.isLoaded}
                isPlaying={playback.isPlaying}
                onBack={requestBack}
                onCollapse={() => setExpandedPlayer(false)}
                onJump={(seconds) => void playback.jumpBy(seconds)}
                onPlayPause={() => void playback.toggleFullPlayback()}
                onRateChange={changePlaybackRate}
                onRetry={() => playback.retry()}
                onSeek={(seconds) => void playback.seekTo(seconds)}
                playbackRate={playbackRate}
                positionSeconds={playback.currentTime}
              />
            ) : (
              <CompactPlayer
                durationSeconds={playbackDuration}
                error={playback.error}
                isBuffering={playback.isBuffering}
                isLoaded={playback.isLoaded}
                isPlaying={playback.isPlaying}
                onBack={requestBack}
                onExpand={() => setExpandedPlayer(true)}
                onPlayPause={() => void playback.toggleFullPlayback()}
                onRetry={() => playback.retry()}
                positionSeconds={playback.currentTime}
              />
            )
          ) : (
            <AnalysisSourceUnavailableCard
              description={
                detail.runtimeMode === 'lightweight_local'
                  ? t('analysisDetail.lightweightDescription')
                  : t('analysisDetail.sourceDescription')
              }
              onBack={requestBack}
              title={
                detail.runtimeMode === 'lightweight_local'
                  ? t('analysisDetail.lightweightNoAudio')
                  : t('analysisDetail.sourceUnavailable')
              }
            />
          )
        }
        transcript={{
          confirming: confirmingTranscript,
          displayMode: transcriptDisplayMode,
          draftSegments: transcriptDraftSegments,
          editing: editingTranscript,
          hideIrrelevant,
          onCancelEditing: cancelTranscriptEditing,
          onConfirmEditing: () => void confirmTranscript(),
          onDisplayModeChange: setTranscriptDisplayMode,
          onDraftChange: (segmentId, text) =>
            setTranscriptDraftSegments((current) =>
              current.map((segment) => (segment.id === segmentId ? { ...segment, text } : segment)),
            ),
          onOpenAiTag: setSelectedTag,
          onOpenEmotion: setEmotionSegment,
          onPlaySegment: (segment) =>
            void playback.playRange({
              endSeconds: segment.endSeconds,
              key: segment.id,
              startSeconds: segment.startSeconds,
            }),
          onPlayReviewFinding: (segment, splitAfterWordIndex) => {
            const boundary = segment.words.find((word) => word.index === splitAfterWordIndex);
            if (!boundary) return;
            void playback.playRange({
              endSeconds: Math.min(segment.endSeconds, boundary.endMs / 1_000 + 2),
              key: `review:${segment.sourceSegmentId}:${splitAfterWordIndex}`,
              startSeconds: Math.max(segment.startSeconds, boundary.endMs / 1_000 - 2),
            });
          },
          onResolveAllReviewFindings: () => void resolveAllSpeakerFindings(),
          onResolveReviewFinding: (findingId) => void resolveOneSpeakerFinding(findingId),
          onSpeakerChange: (segmentId, speakerKey) =>
            setTranscriptDraftSegments((current) =>
              current.map((segment) =>
                segment.id === segmentId
                  ? { ...segment, speakerKey, speakerLabel: speakerKey }
                  : segment,
              ),
            ),
          onSplitSegment: (segment, splitAfterWordIndex) => {
            const splitWord = segment.words.find((word) => word.index === splitAfterWordIndex);
            const nextWord = segment.words.find((word) => word.index === splitAfterWordIndex + 1);
            if (!splitWord || !nextWord) return;
            setTranscriptDraftSegments((current) => {
              const newSpeakerKey = nextSpeakerKey(current);
              const leftEnd = splitAfterWordIndex + 1;
              const left: TranscriptSegment = {
                ...segment,
                id: `${segment.sourceSegmentId}:${segment.startWordIndex}-${leftEnd}`,
                endSeconds: splitWord.endMs / 1_000,
                endWordIndex: leftEnd,
                text: wordsToText(segment, segment.startWordIndex, leftEnd),
                words: segment.words.filter((word) => word.index < leftEnd),
                reviewFindings: segment.reviewFindings.filter(
                  (finding) =>
                    finding.splitAfterWordIndex !== null && finding.splitAfterWordIndex < leftEnd,
                ),
              };
              const right: TranscriptSegment = {
                ...segment,
                id: `${segment.sourceSegmentId}:${leftEnd}-${segment.endWordIndex}`,
                speakerKey: newSpeakerKey,
                speakerLabel: newSpeakerKey,
                startSeconds: nextWord.startMs / 1_000,
                startWordIndex: leftEnd,
                text: wordsToText(segment, leftEnd, segment.endWordIndex),
                words: segment.words.filter((word) => word.index >= leftEnd),
                reviewFindings: segment.reviewFindings.filter(
                  (finding) =>
                    finding.splitAfterWordIndex !== null && finding.splitAfterWordIndex >= leftEnd,
                ),
              };
              return current.flatMap((item) => (item.id === segment.id ? [left, right] : [item]));
            });
          },
          resolvingReviewFinding: resolvingSpeakerReview,
          onStartEditing: startTranscriptEditing,
          playingSegmentId: playback.activeRangeKey,
          segmentPlaybackDisabled:
            !sourceAvailable || !playback.isLoaded || Boolean(playback.error),
          segmentPlaybackLoading: sourceAvailable && playback.isBuffering,
          segmentPlaybackPlaying: sourceAvailable && playback.isPlaying,
          reviewPlaybackAvailable: sourceAvailable,
          selectedSegmentIds: selectedTag?.evidenceSegmentIds ?? [],
          onRefresh: screenRefresh.onRefresh,
          refreshing: screenRefresh.refreshing,
        }}
      />
      <EmotionAnalysisPanel onClose={() => setEmotionSegment(undefined)} segment={emotionSegment} />
      <PostAnalysisConfirmDialog
        onCancel={() => {
          if (!startingAnalysis) setConfirmAnalysisType(undefined);
        }}
        onConfirm={() => void confirmPostAnalysis()}
        pending={startingAnalysis}
        type={confirmAnalysisType}
        language={analysisLanguage}
        onLanguageChange={setAnalysisLanguage}
      />
      {detail.transcriptConfirmation.status === 'confirmed' ? (
        <BusinessAnalysisPreflightDialog
          confirmationVersion={detail.transcriptConfirmation.currentVersion}
          emotion={detail.postAnalysis.emotion}
          onCancel={() => {
            if (!startingBusiness && !supplementingBusiness) setBusinessPreflightVisible(false);
          }}
          onContinue={() => void continueBusinessAnalysis()}
          onSupplement={() => void supplementBusinessAnalysis()}
          pending={startingBusiness || supplementingBusiness}
          role={detail.postAnalysis.role}
          visible={businessPreflightVisible}
          language={analysisLanguage}
          onLanguageChange={setAnalysisLanguage}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  pressed: {
    backgroundColor: colors.background,
  },
  pager: {
    flex: 1,
  },
  sourceUnavailableCard: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 80,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sourceUnavailableCopy: { flex: 1 },
  sourceUnavailableTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  sourceUnavailableDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  page: {
    height: '100%',
  },
  tasksContent: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  unknownTopBar: {
    minHeight: 64,
    paddingHorizontal: spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  loading: { marginTop: spacing.xxl },
  emptyTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginTop: spacing.md,
  },
  emptyDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  returnButton: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  returnButtonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
});
