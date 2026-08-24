/**
 * 分析详情转写内容。
 *
 * 呈现场景、说话人、时间轴及 AI 标签入口，并持有局部过滤状态。
 *
 * Responsibilities:
 * - 封装稳定的展示职责与局部交互。
 * - 页面级状态和导航仍由 AnalysisDetailScreen 统一协调。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import type { AnalysisDetailView, TranscriptSegment } from '../model';
import { Checkbox } from './AnalysisControls';
import { formatTime, showComingSoon } from './utils';

const emotionLabels: Record<string, string> = {
  neutral: '平静',
  happy: '愉快',
  angry: '生气',
  sad: '悲伤',
  anxious: '焦虑',
  excited: '兴奋',
  unknown: '未知',
};

function FilterButton({ label }: { label: string }) {
  return (
    <Pressable
      accessibilityLabel={`${label}筛选`}
      accessibilityRole="button"
      onPress={() => showComingSoon(`${label}筛选`)}
      style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
    >
      <Text style={styles.filterText}>{label}</Text>
      <Ionicons color={colors.ink} name="chevron-down" size={typography.heading5.lineHeight} />
    </Pressable>
  );
}

function SegmentView({
  dimmed,
  onOpenAiTag,
  segment,
}: {
  dimmed: boolean;
  onOpenAiTag: (segment: TranscriptSegment) => void;
  segment: TranscriptSegment;
}) {
  return (
    <View style={styles.segment}>
      <View style={styles.segmentMain}>
        <View style={styles.speakerRow}>
          <Text style={[styles.speakerName, dimmed && styles.dimmedText]}>
            {segment.speakerKey.startsWith('Speaker ') ? segment.speakerKey : segment.speakerLabel}
          </Text>
          <Text style={[styles.businessRole, dimmed && styles.dimmedText]}>
            {segment.businessRole === 'unknown' ? '角色未知' : segment.businessRole}
          </Text>
        </View>
        <View style={styles.emotionRow}>
          <Ionicons
            color={dimmed ? colors.muted : colors.secondary}
            name="happy-outline"
            size={typography.body.lineHeight}
          />
          <Text style={[styles.emotionText, dimmed && styles.dimmedText]}>
            {emotionLabels[segment.emotion] ?? segment.emotion}
          </Text>
        </View>
        <Text style={[styles.transcriptText, dimmed && styles.dimmedText]}>{segment.text}</Text>
        <Text style={styles.segmentTime}>
          {formatTime(segment.startSeconds)} – {formatTime(segment.endSeconds)}
        </Text>
      </View>
      <View style={styles.segmentRail} testID={`timeline-rail-${segment.id}`}>
        {segment.aiTag ? (
          <Pressable
            accessibilityLabel={`查看 AI 标签：${segment.aiTag.title}`}
            accessibilityRole="button"
            onPress={() => onOpenAiTag(segment)}
            style={({ pressed }) => [styles.aiTagButton, pressed && styles.pressed]}
            testID={`ai-tag-timeline-marker-${segment.id}`}
          >
            <Text style={[styles.aiTagText, dimmed && styles.dimmedText]}>AI标签</Text>
            <View style={styles.aiTagNode}>
              <Ionicons
                color={dimmed ? colors.muted : colors.success}
                name="sparkles"
                size={typography.label.lineHeight}
              />
            </View>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function TranscriptContent({
  detail,
  hideIrrelevant,
  onOpenAiTag,
  selectedSegmentId,
}: {
  detail: AnalysisDetailView;
  hideIrrelevant: boolean;
  onOpenAiTag: (segment: TranscriptSegment) => void;
  selectedSegmentId?: string;
}) {
  const [skipInvalid, setSkipInvalid] = useState(false);
  const hasSelectedSegment = selectedSegmentId !== undefined;
  const visibleScenes =
    hasSelectedSegment && hideIrrelevant
      ? detail.scenes.filter((scene) =>
          scene.segments.some((segment) => segment.id === selectedSegmentId),
        )
      : detail.scenes;

  return (
    <ScrollView
      contentContainerStyle={styles.transcriptContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={styles.pageScroll}
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
      {visibleScenes.every((scene) => scene.segments.length === 0) ? (
        <View style={styles.emptyTranscript}>
          <Text style={styles.emptyTranscriptText}>未识别到可转写的语音内容。</Text>
        </View>
      ) : null}
      {visibleScenes.map((scene) => {
        const sceneIndex = detail.scenes.indexOf(scene);
        const visibleSegments =
          hasSelectedSegment && hideIrrelevant
            ? scene.segments.filter((segment) => segment.id === selectedSegmentId)
            : scene.segments;
        const invalidSegment =
          !skipInvalid && !(hasSelectedSegment && hideIrrelevant) && sceneIndex === 0
            ? detail.invalidSegment
            : undefined;

        return (
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
              {visibleSegments.map((segment) => (
                <SegmentView
                  key={segment.id}
                  dimmed={hasSelectedSegment && segment.id !== selectedSegmentId}
                  onOpenAiTag={onOpenAiTag}
                  segment={segment}
                />
              ))}
            </View>
            {invalidSegment ? (
              <View style={styles.invalidSegment}>
                <Ionicons
                  color={colors.muted}
                  name="volume-mute-outline"
                  size={typography.description.lineHeight}
                />
                <Text style={styles.invalidSegmentText}>
                  已跳过 {invalidSegment.durationSeconds} 秒无效片段
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pressed: {
    backgroundColor: colors.background,
  },
  pageScroll: {
    flex: 1,
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
    marginRight: spacing.xs,
    width: 8,
  },
  sceneBody: {
    position: 'relative',
  },
  timelineLine: {
    backgroundColor: colors.divider,
    bottom: 0,
    position: 'absolute',
    right: spacing.sm,
    top: 0,
    width: 2,
  },
  segment: {
    flexDirection: 'row',
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
  },
  segmentMain: {
    flex: 1,
    minWidth: 0,
  },
  segmentRail: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    width: 96,
  },
  speakerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dimmedText: {
    color: textColors.tertiary,
  },
  speakerName: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  businessRole: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
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
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
  },
  aiTagNode: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    height: typography.label.lineHeight,
    justifyContent: 'center',
    width: typography.label.lineHeight,
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
  emptyTranscript: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTranscriptText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
});
