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
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSwipePager } from '@/shared/hooks/useSwipePager';
import { getAudioAnalysis } from '@/shared/api/workspaceApi';
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
import { TranscriptContent } from './components/TranscriptContent';

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
  const [hideIrrelevant, setHideIrrelevant] = useState(getHideIrrelevantSegmentsPreference);
  const changeHideIrrelevant = (value: boolean) => {
    setHideIrrelevantSegmentsPreference(value);
    setHideIrrelevant(value);
  };
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
    tabs: analysisTabKeys,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDetail(toAnalysisDetailView(await getAudioAnalysis(detailId)));
    } catch (reason) {
      setDetail(undefined);
      setError(reason instanceof Error ? reason.message : '分析详情加载失败。');
    } finally {
      setLoading(false);
    }
  }, [detailId]);
  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  useEffect(() => {
    if (!selectedSegment) {
      return undefined;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedSegment(undefined);
      return true;
    });

    return () => subscription.remove();
  }, [selectedSegment]);

  if (loading) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.unknownTopBar}>
          <IconButton icon="chevron-back" label="返回" onPress={onBack} />
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
          <IconButton icon="chevron-back" label="返回" onPress={onBack} />
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
            onPress={onBack}
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
          onBack={onBack}
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
          onBack={onBack}
          onExpand={() => setExpandedPlayer(true)}
          onPlayPause={() => setIsPlaying((value) => !value)}
          positionSeconds={positionSeconds}
        />
      )}
      <DetailTabs activeTab={activeTab} onChange={selectTab} />
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
          <TranscriptContent
            detail={detail}
            hideIrrelevant={hideIrrelevant}
            onOpenAiTag={setSelectedSegment}
            selectedSegmentId={selectedSegment?.id}
          />
        </View>
        <View style={[styles.page, { width: pageWidth }]}>
          <SummaryContent detail={detail} />
        </View>
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
