/** Renders the interactive, presentation-only analysis detail experience. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '../../theme/tokens';
import {
  getAnalysisDetail,
  type AiTagAnalysis,
  type TranscriptSegment,
} from './mockData';

const playbackRates = [1, 1.5, 2] as const;
const waveformHeights = [
  8, 12, 17, 23, 14, 29, 19, 34, 22, 16, 27, 38, 25, 31, 18, 13, 24, 36,
  20, 28, 16, 33, 26, 14, 22, 30, 17, 25, 12, 20, 10, 16,
] as const;

type AnalysisDetailScreenProps = {
  detailId: string;
  onBack: () => void;
};

type AnalysisTab = 'transcript' | 'summary';

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function showComingSoon(feature: string) {
  Alert.alert('功能建设中', `${feature}将在后续版本开放。`);
}

function Waveform({ expanded = false }: { expanded?: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.waveform, expanded && styles.expandedWaveform]}
    >
      <View style={styles.waveformCursor} />
      {waveformHeights.map((height, index) => (
        <View
          // The index is stable because this decorative waveform never changes order.
          key={index}
          style={[
            styles.waveformBar,
            expanded && styles.expandedWaveformBar,
            { height: expanded ? height + 4 : Math.max(4, Math.round(height / 2)) },
          ]}
        />
      ))}
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Ionicons color={colors.ink} name={icon} size={28} />
    </Pressable>
  );
}

function Checkbox({
  checked,
  label,
  onPress,
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={({ pressed }) => [styles.checkboxRow, pressed && styles.pressed]}
    >
      <Text style={styles.checkboxLabel}>{label}</Text>
      <View style={[styles.checkbox, checked && styles.checkedCheckbox]}>
        {checked ? <Ionicons color={colors.white} name="checkmark" size={12} /> : null}
      </View>
    </Pressable>
  );
}

function CompactPlayer({
  durationSeconds,
  isPlaying,
  onBack,
  onExpand,
  onPlayPause,
  positionSeconds,
}: {
  durationSeconds: number;
  isPlaying: boolean;
  onBack: () => void;
  onExpand: () => void;
  onPlayPause: () => void;
  positionSeconds: number;
}) {
  return (
    <View style={styles.compactHeader}>
      <IconButton icon="chevron-back" label="返回" onPress={onBack} />
      <View style={styles.compactPlayer}>
        <Pressable
          accessibilityLabel={isPlaying ? '暂停模拟播放' : '开始模拟播放'}
          accessibilityRole="button"
          onPress={onPlayPause}
          style={({ pressed }) => [
            styles.compactPlayButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            color={colors.ink}
            name={isPlaying ? 'pause' : 'play'}
            size={22}
          />
        </Pressable>
        <Pressable
          accessibilityLabel="展开播放器"
          accessibilityRole="button"
          onPress={onExpand}
          style={({ pressed }) => [
            styles.compactWaveformButton,
            pressed && styles.pressed,
          ]}
        >
          <Waveform />
        </Pressable>
        <Text style={styles.playerTime}>
          {formatTime(positionSeconds)} / {formatTime(durationSeconds)}
        </Text>
      </View>
      <IconButton
        icon="ellipsis-horizontal"
        label="更多操作"
        onPress={() => showComingSoon('更多操作')}
      />
    </View>
  );
}

function ExpandedPlayer({
  durationSeconds,
  isPlaying,
  onBack,
  onCollapse,
  onJump,
  onPlayPause,
  onRateChange,
  playbackRate,
  positionSeconds,
}: {
  durationSeconds: number;
  isPlaying: boolean;
  onBack: () => void;
  onCollapse: () => void;
  onJump: (seconds: number) => void;
  onPlayPause: () => void;
  onRateChange: () => void;
  playbackRate: number;
  positionSeconds: number;
}) {
  return (
    <View style={styles.expandedPlayerContainer}>
      <View style={styles.expandedTopBar}>
        <IconButton icon="chevron-back" label="返回" onPress={onBack} />
        <IconButton
          icon="ellipsis-horizontal"
          label="更多操作"
          onPress={() => showComingSoon('更多操作')}
        />
      </View>
      <View style={styles.largeWaveformArea}>
        <Waveform expanded />
      </View>
      <View style={styles.expandedTimeRow}>
        <Text style={styles.playerTime}>{formatTime(positionSeconds)}</Text>
        <Text style={styles.playerTime}>{formatTime(durationSeconds)}</Text>
      </View>
      <View style={styles.playerControls}>
        <Pressable
          accessibilityLabel={`当前倍速 ${playbackRate.toFixed(1)} 倍，点击切换`}
          accessibilityRole="button"
          onPress={onRateChange}
          style={({ pressed }) => [styles.controlButton, pressed && styles.pressed]}
        >
          <Text style={styles.controlText}>x{playbackRate.toFixed(1)}</Text>
        </Pressable>
        <IconButton icon="play-back" label="后退 15 秒" onPress={() => onJump(-15)} />
        <Pressable
          accessibilityLabel={isPlaying ? '暂停模拟播放' : '开始模拟播放'}
          accessibilityRole="button"
          onPress={onPlayPause}
          style={({ pressed }) => [styles.largePlayButton, pressed && styles.pressed]}
        >
          <Ionicons
            color={colors.ink}
            name={isPlaying ? 'pause' : 'play'}
            size={36}
          />
        </Pressable>
        <IconButton icon="play-forward" label="前进 15 秒" onPress={() => onJump(15)} />
        <IconButton icon="contract-outline" label="收起播放器" onPress={onCollapse} />
      </View>
    </View>
  );
}

function DetailTabs({
  activeTab,
  onChange,
}: {
  activeTab: AnalysisTab;
  onChange: (tab: AnalysisTab) => void;
}) {
  const tabs: readonly { key: AnalysisTab; label: string }[] = [
    { key: 'transcript', label: '转写分析' },
    { key: 'summary', label: '分析总结' },
  ];

  return (
    <View accessibilityRole="tablist" style={styles.detailTabs}>
      {tabs.map((tab) => {
        const selected = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.detailTab, pressed && styles.pressed]}
          >
            <Text style={[styles.detailTabText, selected && styles.activeDetailTabText]}>
              {tab.label}
            </Text>
            <View style={[styles.tabUnderline, selected && styles.activeTabUnderline]} />
          </Pressable>
        );
      })}
    </View>
  );
}

function FilterButton({ label }: { label: string }) {
  return (
    <Pressable
      accessibilityLabel={`${label}筛选`}
      accessibilityRole="button"
      onPress={() => showComingSoon(`${label}筛选`)}
      style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
    >
      <Text style={styles.filterText}>{label}</Text>
      <Ionicons
        color={colors.ink}
        name="chevron-down"
        size={typography.heading5.lineHeight}
      />
    </Pressable>
  );
}

function SegmentView({
  onOpenAiTag,
  segment,
}: {
  onOpenAiTag: (segment: TranscriptSegment) => void;
  segment: TranscriptSegment;
}) {
  return (
    <View style={styles.segment}>
      <View style={styles.speakerRow}>
        {segment.speaker === 'self' ? <View style={styles.selfMarker} /> : null}
        <Text style={styles.speakerName}>{segment.speakerLabel}</Text>
        {segment.speaker === 'host' ? (
          <Ionicons color="#ff5964" name="pulse" size={typography.heading3.lineHeight} />
        ) : null}
      </View>
      <View style={styles.emotionRow}>
        <Ionicons
          color={colors.secondary}
          name="happy-outline"
          size={typography.body.lineHeight}
        />
        <Text style={styles.emotionText}>{segment.emotion}</Text>
      </View>
      <Text style={styles.transcriptText}>{segment.text}</Text>
      {segment.aiTag ? (
        <Pressable
          accessibilityLabel={`查看 AI 标签：${segment.aiTag.title}`}
          accessibilityRole="button"
          onPress={() => onOpenAiTag(segment)}
          style={({ pressed }) => [styles.aiTagButton, pressed && styles.pressed]}
        >
          <Text style={styles.aiTagText}>AI标签</Text>
          <Ionicons
            color={colors.success}
            name="sparkles"
            size={typography.label.lineHeight}
          />
        </Pressable>
      ) : null}
      <Text style={styles.segmentTime}>
        {formatTime(segment.startSeconds)} – {formatTime(segment.endSeconds)}
      </Text>
    </View>
  );
}

function TranscriptContent({
  detail,
  onOpenAiTag,
}: {
  detail: NonNullable<ReturnType<typeof getAnalysisDetail>>;
  onOpenAiTag: (segment: TranscriptSegment) => void;
}) {
  const [skipInvalid, setSkipInvalid] = useState(false);

  return (
    <ScrollView
      contentContainerStyle={styles.transcriptContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.filters}>
        <FilterButton label="全部场景" />
        <FilterButton label="全部文本" />
        <FilterButton label="全部标签" />
        <Checkbox
          checked={skipInvalid}
          label="跳过无效音频"
          onPress={() => setSkipInvalid((value) => !value)}
        />
      </View>
      {detail.scenes.map((scene, sceneIndex) => (
        <View key={scene.id} style={styles.scene}>
          <View style={styles.sceneTitleRow}>
            <View style={styles.sceneTitleLine} />
            <Text style={styles.sceneTitle}>
              {sceneIndex + 1}. {scene.title}
            </Text>
            <View style={styles.sceneTitleLine} />
          </View>
          <View style={styles.timelineTimeRow}>
            <Text style={styles.timelineTime}>{formatTime(scene.startSeconds)}</Text>
            <View style={styles.timelineDot} />
          </View>
          <View style={styles.sceneBody}>
            <View style={styles.timelineLine} />
            {scene.segments.map((segment) => (
              <SegmentView
                key={segment.id}
                onOpenAiTag={onOpenAiTag}
                segment={segment}
              />
            ))}
          </View>
          {!skipInvalid && sceneIndex === 0 && detail.invalidSegment ? (
            <View style={styles.invalidSegment}>
              <Ionicons
                color={colors.muted}
                name="volume-mute-outline"
                size={typography.description.lineHeight}
              />
              <Text style={styles.invalidSegmentText}>
                已跳过 {detail.invalidSegment.durationSeconds} 秒无效片段
              </Text>
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

function SummaryContent({
  detail,
}: {
  detail: NonNullable<ReturnType<typeof getAnalysisDetail>>;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.summaryContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.summaryDescription}>AI 智能分析，内容仅供参考</Text>
      <View style={styles.summaryTitleRow}>
        <Ionicons color={colors.success} name="sparkles" size={34} />
        <Text style={styles.summaryTitle}>{detail.title}</Text>
      </View>
      <Text style={styles.generatedAt}>生成时间：{detail.generatedAt}</Text>
      <View style={styles.summaryDivider} />
      {detail.summarySections.map((section) => (
        <View key={section.id} style={styles.summarySection}>
          <Text style={styles.summarySectionTitle}>{section.title}</Text>
          <Text style={styles.summaryBody}>{section.body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function AiTagSheet({
  analysis,
  endSeconds,
  onClose,
  startSeconds,
}: {
  analysis: AiTagAnalysis | undefined;
  endSeconds: number;
  onClose: () => void;
  startSeconds: number;
}) {
  const [hideIrrelevant, setHideIrrelevant] = useState(false);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={analysis !== undefined}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="关闭 AI 标签面板"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <Pressable
            accessibilityLabel="收起 AI 标签面板"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.sheetHandle, pressed && styles.pressed]}
          >
            <Ionicons color={colors.secondary} name="chevron-down" size={26} />
          </Pressable>
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <Text style={styles.sheetMeta}>
              AI标签 · 涉及片段 · {formatTime(startSeconds)} ～ {formatTime(endSeconds)}
            </Text>
            <View style={styles.sheetCheckbox}>
              <Checkbox
                checked={hideIrrelevant}
                label="隐藏无关片段"
                onPress={() => setHideIrrelevant((value) => !value)}
              />
            </View>
            <View style={styles.sheetTitleRow}>
              <Ionicons color={colors.success} name="sparkles" size={34} />
              <Text style={styles.sheetTitle}>{analysis?.title}</Text>
            </View>
            <Text style={styles.sheetDescription}>AI 智能分析，内容仅供参考</Text>
            <Text style={styles.analysisParagraphTitle}>分析结论</Text>
            <Text style={styles.analysisParagraph}>{analysis?.summary}</Text>
            {analysis?.details.map((detail) => (
              <View key={detail} style={styles.analysisDetailRow}>
                <View style={styles.analysisBullet} />
                <Text style={styles.analysisParagraph}>{detail}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function AnalysisDetailScreen({ detailId, onBack }: AnalysisDetailScreenProps) {
  const detail = getAnalysisDetail(detailId);
  const [activeTab, setActiveTab] = useState<AnalysisTab>('transcript');
  const [expandedPlayer, setExpandedPlayer] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRateIndex, setPlaybackRateIndex] = useState(0);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [selectedSegment, setSelectedSegment] = useState<TranscriptSegment>();

  if (!detail) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.unknownTopBar}>
          <IconButton icon="chevron-back" label="返回" onPress={onBack} />
        </View>
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Ionicons color={colors.secondary} name="document-outline" size={36} />
          <Text style={styles.emptyTitle}>未找到分析详情</Text>
          <Text style={styles.emptyDescription}>该音频可能尚未完成分析，请返回后重试。</Text>
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
  const changeTab = (tab: AnalysisTab) => {
    setActiveTab(tab);
    if (tab === 'summary') {
      setExpandedPlayer(false);
      setSelectedSegment(undefined);
    }
  };
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
          onRateChange={() =>
            setPlaybackRateIndex((index) => (index + 1) % playbackRates.length)
          }
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
      <DetailTabs activeTab={activeTab} onChange={changeTab} />
      {activeTab === 'transcript' ? (
        <TranscriptContent detail={detail} onOpenAiTag={setSelectedSegment} />
      ) : (
        <SummaryContent detail={detail} />
      )}
      <AiTagSheet
        analysis={selectedSegment?.aiTag}
        endSeconds={selectedSegment?.endSeconds ?? 0}
        onClose={() => setSelectedSegment(undefined)}
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
  compactHeader: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 88,
    paddingHorizontal: spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: {
    backgroundColor: colors.background,
  },
  compactPlayer: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minWidth: 0,
  },
  compactPlayButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  compactWaveformButton: {
    flex: 1,
    minWidth: 72,
    paddingVertical: spacing.sm,
  },
  waveform: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 28,
    justifyContent: 'space-between',
  },
  expandedWaveform: {
    height: 52,
  },
  waveformCursor: {
    backgroundColor: '#ff5964',
    height: '100%',
    marginRight: spacing.xs,
    width: 2,
  },
  waveformBar: {
    backgroundColor: colors.secondary,
    borderRadius: radii.round,
    flex: 1,
    maxWidth: 2,
    minWidth: 1,
  },
  expandedWaveformBar: {
    backgroundColor: colors.ink,
    maxWidth: 3,
  },
  playerTime: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    flexShrink: 0,
  },
  expandedPlayerContainer: {
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.lg,
  },
  expandedTopBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: spacing.sm,
  },
  largeWaveformArea: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  expandedTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.base,
  },
  playerControls: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  controlButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    minWidth: 44,
  },
  controlText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  largePlayButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  detailTabs: {
    flexDirection: 'row',
    gap: spacing.lg,
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  detailTab: {
    justifyContent: 'flex-end',
  },
  detailTabText: {
    ...typography.heading5,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    paddingBottom: spacing.base,
  },
  activeDetailTabText: {
    ...typography.heading4,
    color: textColors.primary,
  },
  tabUnderline: {
    backgroundColor: 'transparent',
    height: 2,
  },
  activeTabUnderline: {
    backgroundColor: colors.ink,
  },
  transcriptContent: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  filters: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  filterButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
  },
  filterText: {
    ...typography.heading5,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  checkboxRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
  },
  checkboxLabel: {
    ...typography.heading5,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.ink,
    borderRadius: radii.default,
    borderWidth: 1,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  checkedCheckbox: {
    backgroundColor: colors.ink,
  },
  scene: {
    paddingTop: spacing.md,
  },
  sceneTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  sceneTitleLine: {
    backgroundColor: colors.secondary,
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  sceneTitle: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  timelineTimeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  timelineTime: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  timelineDot: {
    backgroundColor: colors.ink,
    borderRadius: radii.round,
    height: 8,
    width: 8,
  },
  sceneBody: {
    paddingRight: spacing.lg,
    position: 'relative',
  },
  timelineLine: {
    backgroundColor: colors.divider,
    bottom: 0,
    position: 'absolute',
    right: spacing.xs,
    top: 0,
    width: 2,
  },
  segment: {
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
  },
  speakerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  selfMarker: {
    backgroundColor: colors.success,
    borderRadius: radii.round,
    height: 12,
    width: 12,
  },
  speakerName: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  emotionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  emotionText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.kai,
  },
  transcriptText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.kai,
    marginTop: spacing.sm,
  },
  aiTagButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    minHeight: 32,
  },
  aiTagText: {
    ...typography.label,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    textDecorationLine: 'underline',
  },
  segmentTime: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  invalidSegment: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.base,
  },
  invalidSegmentText: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  summaryContent: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  summaryDescription: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  summaryTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  summaryTitle: {
    ...typography.analysisDisplay,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  generatedAt: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xl,
  },
  summaryDivider: {
    backgroundColor: colors.divider,
    height: StyleSheet.hairlineWidth,
    marginBottom: spacing.xl,
    marginTop: spacing.lg,
  },
  summarySection: {
    marginBottom: spacing.xl,
  },
  summarySectionTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginBottom: spacing.sm,
  },
  summaryBody: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  modalRoot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '64%',
    maxWidth: 480,
    width: '100%',
  },
  sheetHandle: {
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  sheetContent: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  sheetMeta: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  sheetCheckbox: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  sheetTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  sheetTitle: {
    ...typography.analysisDisplay,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  sheetDescription: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginLeft: 48,
    marginTop: spacing.xs,
  },
  analysisParagraphTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginTop: spacing.xl,
  },
  analysisParagraph: {
    ...typography.body,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
  analysisDetailRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  analysisBullet: {
    backgroundColor: colors.success,
    borderRadius: radii.round,
    height: 8,
    marginTop: spacing.md,
    width: 8,
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
