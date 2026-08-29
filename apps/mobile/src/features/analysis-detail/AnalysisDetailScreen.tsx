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
import type { AudioAiExecutionTraceResponse, AudioPostAnalysisType } from '@echowave/contracts';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSwipePager } from '@/shared/hooks/useSwipePager';
import { useAudioPlayback } from '@/shared/audio/useAudioPlayback';
import {
  confirmAudioTranscript,
  getAudioAnalysis,
  getAudioExecutionTrace,
  getGroupSettings,
  startAudioBusinessAnalysis,
  startAudioEmotionAnalysis,
  startAudioRoleRecognition,
  WorkspaceRequestError,
} from '@/shared/api/workspaceApi';
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
import { AiTagPanel } from './components/AiTagPanel';
import { IconButton } from './components/AnalysisControls';
import { analysisTabKeys, DetailTabs, type AnalysisTab } from './components/AnalysisTabs';
import { CompactPlayer, ExpandedPlayer } from './components/Player';
import { SummaryContent } from './components/SummaryContent';
import { TranscriptContent, type TranscriptDisplayMode } from './components/TranscriptContent';
import { EmotionAnalysisPanel } from './components/EmotionAnalysisPanel';
import { ModelExecutionContent } from './components/ModelExecutionContent';
import { PostAnalysisConfirmDialog, PostAnalysisControls } from './components/PostAnalysisControls';
import {
  BusinessAnalysisControls,
  BusinessAnalysisPreflightDialog,
} from './components/BusinessAnalysisControls';

const playbackRates = [1, 1.5, 2] as const;

type AnalysisDetailScreenProps = {
  detailId: string;
  groupId?: string;
  onBack: () => void;
};

/** 渲染指定分析记录的转写、摘要和交互式播放展示。 */
export function AnalysisDetailScreen({ detailId, groupId, onBack }: AnalysisDetailScreenProps) {
  const [detail, setDetail] = useState<AnalysisDetailView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [executionTrace, setExecutionTrace] = useState<AudioAiExecutionTraceResponse>();
  const [executionTraceLoading, setExecutionTraceLoading] = useState(false);
  const [executionTraceScope, setExecutionTraceScope] = useState('');
  const [executionTraceError, setExecutionTraceError] = useState('');
  const [activeTab, setActiveTab] = useState<AnalysisTab>('transcript');
  const [expandedPlayer, setExpandedPlayer] = useState(false);
  const [playbackRateIndex, setPlaybackRateIndex] = useState(0);
  const [selectedTag, setSelectedTag] = useState<AiTagAnalysis>();
  const [emotionSegment, setEmotionSegment] = useState<TranscriptSegment>();
  const [confirmAnalysisType, setConfirmAnalysisType] = useState<AudioPostAnalysisType>();
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [confirmingTranscript, setConfirmingTranscript] = useState(false);
  const [transcriptDisplayMode, setTranscriptDisplayMode] =
    useState<TranscriptDisplayMode>('current');
  const [transcriptDrafts, setTranscriptDrafts] = useState<Record<string, string>>({});
  const [hideIrrelevant, setHideIrrelevant] = useState(getHideIrrelevantSegmentsPreference);
  const [businessPreflightVisible, setBusinessPreflightVisible] = useState(false);
  const [businessForce, setBusinessForce] = useState(false);
  const [startingBusiness, setStartingBusiness] = useState(false);
  const [supplementingBusiness, setSupplementingBusiness] = useState(false);
  const [analysisTiming, setAnalysisTiming] = useState<'automatic' | 'manual'>('manual');
  const [preflightPrompted, setPreflightPrompted] = useState(false);
  const playback = useAudioPlayback(detailId || undefined);
  const changeHideIrrelevant = (value: boolean) => {
    setHideIrrelevantSegmentsPreference(value);
    setHideIrrelevant(value);
  };
  const hasSummary = Boolean(detail?.summarySections.length);
  const currentExecutionScope = `${detailId}:${groupId ?? ''}`;
  const currentExecutionTrace =
    executionTraceScope === currentExecutionScope ? executionTrace : undefined;
  const transcriptSegments = detail?.scenes.flatMap((scene) => scene.segments) ?? [];
  const transcriptDirty =
    editingTranscript &&
    transcriptSegments.some(
      (segment) => (transcriptDrafts[segment.id] ?? segment.text) !== segment.text,
    );
  const applyTabChange = (tab: AnalysisTab) => {
    setActiveTab(tab);
    if (tab !== 'transcript') {
      setExpandedPlayer(false);
      setSelectedTag(undefined);
    }
  };
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } = useSwipePager({
    activeTab,
    onTabChange: applyTabChange,
    tabs: hasSummary ? analysisTabKeys : (['transcript', 'model'] as AnalysisTab[]),
  });

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError('');
      try {
        setDetail(toAnalysisDetailView(await getAudioAnalysis(detailId, groupId)));
      } catch (reason) {
        if (showLoading) setDetail(undefined);
        setError(reason instanceof Error ? reason.message : '分析详情加载失败。');
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [detailId, groupId],
  );
  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);
  const loadExecutionTrace = useCallback(
    async (showLoading = true) => {
      if (showLoading) setExecutionTraceLoading(true);
      setExecutionTraceError('');
      try {
        setExecutionTrace(await getAudioExecutionTrace(detailId, groupId));
      } catch (reason) {
        setExecutionTraceError(reason instanceof Error ? reason.message : '模型详情加载失败。');
      } finally {
        setExecutionTraceScope(currentExecutionScope);
        if (showLoading) setExecutionTraceLoading(false);
      }
    },
    [currentExecutionScope, detailId, groupId],
  );
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

  const pollingPostAnalysis =
    detail?.postAnalysis.emotion.state === 'queued' ||
    detail?.postAnalysis.emotion.state === 'running' ||
    detail?.postAnalysis.role.state === 'queued' ||
    detail?.postAnalysis.role.state === 'running' ||
    detail?.businessAnalysis.state === 'queued' ||
    detail?.businessAnalysis.state === 'running';
  useEffect(() => {
    if (!pollingPostAnalysis) return undefined;
    const timer = setInterval(() => void load(false), 2_000);
    return () => clearInterval(timer);
  }, [load, pollingPostAnalysis]);
  const pollingExecutionTrace =
    pollingPostAnalysis || currentExecutionTrace?.runs.some((run) => run.status === 'running');
  useEffect(() => {
    if (activeTab !== 'model' || !pollingExecutionTrace) return undefined;
    const timer = setInterval(() => void loadExecutionTrace(false), 2_000);
    return () => clearInterval(timer);
  }, [activeTab, loadExecutionTrace, pollingExecutionTrace]);

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
      setBusinessPreflightVisible(true);
    }, 0);
    return () => clearTimeout(task);
  }, [detail, groupId, preflightPrompted]);

  const requestBusinessAnalysis = (force: boolean) => {
    if (!groupId || !detail) {
      Alert.alert('无法开始分析', '缺少当前分组，请从分组或数据源中重新进入。');
      return;
    }
    if (detail.transcriptConfirmation.status !== 'confirmed') {
      Alert.alert('请先确认转写', 'ASR 结果分析始终使用用户确认后的正文。');
      setActiveTab('transcript');
      return;
    }
    setBusinessForce(force);
    setBusinessPreflightVisible(true);
  };

  const continueBusinessAnalysis = async () => {
    if (!groupId || startingBusiness) return;
    setStartingBusiness(true);
    try {
      await startAudioBusinessAnalysis(detailId, { groupId, force: businessForce });
      setBusinessPreflightVisible(false);
      await load(false);
    } catch (reason) {
      Alert.alert('无法开始分析', reason instanceof Error ? reason.message : '请稍后重试。');
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
        emotion.confirmationVersion !== version
      ) {
        tasks.push(startAudioEmotionAnalysis(detailId));
      }
      if (
        role.state === 'idle' ||
        role.state === 'failed' ||
        role.confirmationVersion !== version
      ) {
        tasks.push(startAudioRoleRecognition(detailId));
      }
      await Promise.all(tasks);
      setBusinessPreflightVisible(false);
      await load(false);
      Alert.alert(
        tasks.length > 0 ? '识别任务已启动' : '识别任务进行中',
        '完成后可再次点击“开始分析”。',
      );
    } catch (reason) {
      Alert.alert('无法补充识别', reason instanceof Error ? reason.message : '请稍后重试。');
    } finally {
      setSupplementingBusiness(false);
    }
  };

  const confirmPostAnalysis = async () => {
    if (!confirmAnalysisType || startingAnalysis) return;
    if (detail?.transcriptConfirmation.status !== 'confirmed') {
      Alert.alert('请先确认转写', '情绪分析和角色识别始终使用用户确认后的正文。');
      return;
    }
    setStartingAnalysis(true);
    try {
      if (confirmAnalysisType === 'emotion') await startAudioEmotionAnalysis(detailId);
      else await startAudioRoleRecognition(detailId);
      setConfirmAnalysisType(undefined);
      await load(false);
      if (analysisTiming === 'automatic' && groupId) {
        setBusinessForce(false);
        setBusinessPreflightVisible(true);
      }
    } catch (reason) {
      Alert.alert('无法开始分析', reason instanceof Error ? reason.message : '请稍后重试。');
    } finally {
      setStartingAnalysis(false);
    }
  };

  const finishTranscriptEditing = () => {
    setEditingTranscript(false);
    setConfirmingTranscript(false);
    setTranscriptDrafts({});
    setTranscriptDisplayMode('current');
  };

  const startTranscriptEditing = () => {
    if (!detail) return;
    setTranscriptDrafts(
      Object.fromEntries(
        detail.scenes.flatMap((scene) =>
          scene.segments.map((segment) => [segment.id, segment.text]),
        ),
      ),
    );
    setTranscriptDisplayMode('current');
    setEditingTranscript(true);
  };

  const cancelTranscriptEditing = () => {
    if (!transcriptDirty) {
      finishTranscriptEditing();
      return;
    }
    Alert.alert('放弃未确认的修改？', '离开编辑后，本次修改不会被保存。', [
      { text: '继续编辑', style: 'cancel' },
      { text: '放弃修改', style: 'destructive', onPress: finishTranscriptEditing },
    ]);
  };

  const confirmTranscript = async () => {
    if (!detail || confirmingTranscript) return;
    const segments = transcriptSegments.map((segment) => ({
      segmentId: segment.id,
      text: transcriptDrafts[segment.id] ?? segment.text,
    }));
    if (segments.some((segment) => segment.text.trim().length === 0)) {
      Alert.alert('无法确认转写', '每个转写片段都必须保留非空正文。');
      return;
    }
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
        Alert.alert('确认版本已更新', reason.message, [
          { text: '保留草稿', style: 'cancel' },
          {
            text: '重新加载并放弃草稿',
            style: 'destructive',
            onPress: () => {
              finishTranscriptEditing();
              void load(false);
            },
          },
        ]);
      } else {
        Alert.alert('无法确认转写', reason instanceof Error ? reason.message : '请稍后重试。');
      }
    } finally {
      setConfirmingTranscript(false);
    }
  };

  const requestBack = useCallback(() => {
    if (!transcriptDirty) {
      onBack();
      return;
    }
    Alert.alert('放弃未确认的修改？', '返回后，本次修改不会被保存。', [
      { text: '继续编辑', style: 'cancel' },
      { text: '放弃并返回', style: 'destructive', onPress: onBack },
    ]);
  }, [onBack, transcriptDirty]);

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
          <IconButton icon="chevron-back" label="返回" onPress={requestBack} />
        </View>
        <ActivityIndicator
          accessibilityLabel="正在加载分析详情"
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
          <IconButton icon="chevron-back" label="返回" onPress={requestBack} />
        </View>
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Ionicons color={colors.secondary} name="document-outline" size={36} />
          <Text style={styles.emptyTitle}>未找到分析详情</Text>
          <Text accessibilityRole="alert" style={styles.emptyDescription}>
            {error || '该音频可能尚未完成分析，请返回后重试。'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={({ pressed }) => [styles.returnButton, pressed && styles.pressed]}
          >
            <Text style={styles.returnButtonText}>重新加载</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={requestBack}
            style={({ pressed }) => [styles.returnButton, pressed && styles.pressed]}
          >
            <Text style={styles.returnButtonText}>返回分组</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
      {expandedPlayer ? (
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
      )}
      <DetailTabs activeTab={activeTab} onChange={selectTab} showSummary={hasSummary} />
      <ScrollView
        accessibilityLabel="分析详情分页"
        directionalLockEnabled
        horizontal
        nestedScrollEnabled
        onMomentumScrollEnd={handleMomentumScrollEnd}
        pagingEnabled
        ref={pagerRef}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        testID="analysis-tab-pager"
      >
        <View style={[styles.page, { width: pageWidth }]}>
          <PostAnalysisControls
            confirmed={detail.transcriptConfirmation.status === 'confirmed'}
            emotion={detail.postAnalysis.emotion}
            onStart={setConfirmAnalysisType}
            role={detail.postAnalysis.role}
          />
          {groupId ? (
            <BusinessAnalysisControls
              onStart={requestBusinessAnalysis}
              state={detail.businessAnalysis}
            />
          ) : null}
          <TranscriptContent
            confirming={confirmingTranscript}
            detail={detail}
            displayMode={transcriptDisplayMode}
            draftTexts={transcriptDrafts}
            editing={editingTranscript}
            hideIrrelevant={hideIrrelevant}
            onCancelEditing={cancelTranscriptEditing}
            onConfirmEditing={() => void confirmTranscript()}
            onDisplayModeChange={setTranscriptDisplayMode}
            onDraftChange={(segmentId, text) =>
              setTranscriptDrafts((current) => ({ ...current, [segmentId]: text }))
            }
            onOpenAiTag={setSelectedTag}
            onOpenEmotion={setEmotionSegment}
            onPlaySegment={(segment) =>
              void playback.playRange({
                endSeconds: segment.endSeconds,
                key: segment.id,
                startSeconds: segment.startSeconds,
              })
            }
            onStartEditing={startTranscriptEditing}
            playingSegmentId={playback.activeRangeKey}
            segmentPlaybackDisabled={!playback.isLoaded || Boolean(playback.error)}
            segmentPlaybackLoading={playback.isBuffering}
            segmentPlaybackPlaying={playback.isPlaying}
            selectedSegmentIds={selectedTag?.evidenceSegmentIds ?? []}
          />
        </View>
        {hasSummary ? (
          <View style={[styles.page, { width: pageWidth }]}>
            <SummaryContent detail={detail} />
          </View>
        ) : null}
        <View style={[styles.page, { width: pageWidth }]}>
          <ModelExecutionContent
            error={executionTraceError}
            loading={executionTraceLoading}
            onRetry={() => void loadExecutionTrace()}
            trace={currentExecutionTrace}
          />
        </View>
      </ScrollView>
      <AiTagPanel
        analysis={selectedTag}
        audioExpanded={expandedPlayer}
        hideIrrelevant={hideIrrelevant}
        onClose={() => setSelectedTag(undefined)}
        onHideIrrelevantChange={changeHideIrrelevant}
        segments={transcriptSegments.filter((segment) =>
          selectedTag?.evidenceSegmentIds.includes(segment.id),
        )}
      />
      <EmotionAnalysisPanel onClose={() => setEmotionSegment(undefined)} segment={emotionSegment} />
      <PostAnalysisConfirmDialog
        onCancel={() => {
          if (!startingAnalysis) setConfirmAnalysisType(undefined);
        }}
        onConfirm={() => void confirmPostAnalysis()}
        pending={startingAnalysis}
        type={confirmAnalysisType}
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
  page: {
    height: '100%',
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
