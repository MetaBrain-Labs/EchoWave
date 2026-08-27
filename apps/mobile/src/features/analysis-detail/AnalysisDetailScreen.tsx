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
import type { AudioPostAnalysisType } from '@echowave/contracts';
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
import {
  confirmAudioTranscript,
  getAudioAnalysis,
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
import { toAnalysisDetailView, type AnalysisDetailView, type TranscriptSegment } from './model';
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
import { PostAnalysisConfirmDialog, PostAnalysisControls } from './components/PostAnalysisControls';

const playbackRates = [1, 1.5, 2] as const;

type AnalysisDetailScreenProps = {
  detailId: string;
  onBack: () => void;
};

/** 渲染指定分析记录的转写、摘要和交互式播放展示。 */
export function AnalysisDetailScreen({ detailId, onBack }: AnalysisDetailScreenProps) {
  const [detail, setDetail] = useState<AnalysisDetailView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<AnalysisTab>('transcript');
  const [expandedPlayer, setExpandedPlayer] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRateIndex, setPlaybackRateIndex] = useState(0);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [selectedSegment, setSelectedSegment] = useState<TranscriptSegment>();
  const [emotionSegment, setEmotionSegment] = useState<TranscriptSegment>();
  const [confirmAnalysisType, setConfirmAnalysisType] = useState<AudioPostAnalysisType>();
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [confirmingTranscript, setConfirmingTranscript] = useState(false);
  const [transcriptDisplayMode, setTranscriptDisplayMode] =
    useState<TranscriptDisplayMode>('current');
  const [transcriptDrafts, setTranscriptDrafts] = useState<Record<string, string>>({});
  const [hideIrrelevant, setHideIrrelevant] = useState(getHideIrrelevantSegmentsPreference);
  const changeHideIrrelevant = (value: boolean) => {
    setHideIrrelevantSegmentsPreference(value);
    setHideIrrelevant(value);
  };
  const hasSummary = Boolean(detail?.summarySections.length);
  const transcriptSegments = detail?.scenes.flatMap((scene) => scene.segments) ?? [];
  const transcriptDirty =
    editingTranscript &&
    transcriptSegments.some(
      (segment) => (transcriptDrafts[segment.id] ?? segment.text) !== segment.text,
    );
  const applyTabChange = (tab: AnalysisTab) => {
    setActiveTab(tab);
    if (tab === 'summary') {
      setExpandedPlayer(false);
      setSelectedSegment(undefined);
    }
  };
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } = useSwipePager({
    activeTab,
    onTabChange: applyTabChange,
    tabs: hasSummary ? analysisTabKeys : (['transcript'] as AnalysisTab[]),
  });

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError('');
      try {
        setDetail(toAnalysisDetailView(await getAudioAnalysis(detailId)));
      } catch (reason) {
        if (showLoading) setDetail(undefined);
        setError(reason instanceof Error ? reason.message : '分析详情加载失败。');
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [detailId],
  );
  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const pollingPostAnalysis =
    detail?.postAnalysis.emotion.state === 'queued' ||
    detail?.postAnalysis.emotion.state === 'running' ||
    detail?.postAnalysis.role.state === 'queued' ||
    detail?.postAnalysis.role.state === 'running';
  useEffect(() => {
    if (!pollingPostAnalysis) return undefined;
    const timer = setInterval(() => void load(false), 2_000);
    return () => clearInterval(timer);
  }, [load, pollingPostAnalysis]);

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
      if (selectedSegment) {
        setSelectedSegment(undefined);
        return true;
      }
      if (transcriptDirty) {
        requestBack();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [requestBack, selectedSegment, transcriptDirty]);

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
  const jump = (seconds: number) => {
    setPositionSeconds((current) =>
      Math.min(detail.durationSeconds, Math.max(0, current + seconds)),
    );
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      {expandedPlayer ? (
        <ExpandedPlayer
          durationSeconds={detail.durationSeconds}
          isPlaying={isPlaying}
          onBack={requestBack}
          onCollapse={() => setExpandedPlayer(false)}
          onJump={jump}
          onPlayPause={() => setIsPlaying((value) => !value)}
          onRateChange={() => setPlaybackRateIndex((index) => (index + 1) % playbackRates.length)}
          playbackRate={playbackRate}
          positionSeconds={positionSeconds}
        />
      ) : (
        <CompactPlayer
          durationSeconds={detail.durationSeconds}
          isPlaying={isPlaying}
          onBack={requestBack}
          onExpand={() => setExpandedPlayer(true)}
          onPlayPause={() => setIsPlaying((value) => !value)}
          positionSeconds={positionSeconds}
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
            onOpenAiTag={setSelectedSegment}
            onOpenEmotion={setEmotionSegment}
            onStartEditing={startTranscriptEditing}
            selectedSegmentId={selectedSegment?.id}
          />
        </View>
        {hasSummary ? (
          <View style={[styles.page, { width: pageWidth }]}>
            <SummaryContent detail={detail} />
          </View>
        ) : null}
      </ScrollView>
      <AiTagPanel
        analysis={selectedSegment?.aiTag}
        audioExpanded={expandedPlayer}
        endSeconds={selectedSegment?.endSeconds ?? 0}
        hideIrrelevant={hideIrrelevant}
        onClose={() => setSelectedSegment(undefined)}
        onHideIrrelevantChange={changeHideIrrelevant}
        startSeconds={selectedSegment?.startSeconds ?? 0}
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
