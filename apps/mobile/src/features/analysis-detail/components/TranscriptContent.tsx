/**
 * 分析详情转写内容。
 *
 * 呈现场景、说话人、时间轴及 AI 标签入口，并持有局部过滤状态。
 *
 * Responsibilities:
 * - 封装稳定的展示职责与局部交互。
 * - 页面级状态和导航仍由 AnalysisDetailScreen 统一协调。
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "@/shared/theme/tokens";
import { getAnalysisDetail, type TranscriptSegment } from "../mockData";
import { Checkbox } from "./AnalysisControls";
import { formatTime, showComingSoon } from "./utils";

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
      <View style={styles.speakerRow}>
        {segment.speaker === 'self' ? (
          <View style={[styles.selfMarker, dimmed && styles.dimmedMarker]} />
        ) : null}
        <Text style={[styles.speakerName, dimmed && styles.dimmedText]}>
          {segment.speakerLabel}
        </Text>
        {segment.speaker === 'host' ? (
          <Ionicons
            color={dimmed ? colors.muted : '#ff5964'}
            name="pulse"
            size={typography.heading3.lineHeight}
          />
        ) : null}
      </View>
      <View style={styles.emotionRow}>
        <Ionicons
          color={dimmed ? colors.muted : colors.secondary}
          name="happy-outline"
          size={typography.body.lineHeight}
        />
        <Text style={[styles.emotionText, dimmed && styles.dimmedText]}>
          {segment.emotion}
        </Text>
      </View>
      <Text style={[styles.transcriptText, dimmed && styles.dimmedText]}>
        {segment.text}
      </Text>
      {segment.aiTag ? (
        <Pressable
          accessibilityLabel={`查看 AI 标签：${segment.aiTag.title}`}
          accessibilityRole="button"
          onPress={() => onOpenAiTag(segment)}
          style={({ pressed }) => [styles.aiTagButton, pressed && styles.pressed]}
        >
          <Text style={[styles.aiTagText, dimmed && styles.dimmedText]}>
            AI标签
          </Text>
          <Ionicons
            color={dimmed ? colors.muted : colors.success}
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

export function TranscriptContent({
  detail,
  hideIrrelevant,
  onOpenAiTag,
  selectedSegmentId,
}: {
  detail: NonNullable<ReturnType<typeof getAnalysisDetail>>;
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
      {visibleScenes.map((scene) => {
        const sceneIndex = detail.scenes.indexOf(scene);
        const visibleSegments =
          hasSelectedSegment && hideIrrelevant
            ? scene.segments.filter((segment) => segment.id === selectedSegmentId)
            : scene.segments;
        const invalidSegment =
          !skipInvalid &&
          !(hasSelectedSegment && hideIrrelevant) &&
          sceneIndex === 0
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
              <Text style={styles.timelineTime}>
                {formatTime(scene.startSeconds)}
              </Text>
              <View style={styles.timelineDot} />
            </View>
            <View style={styles.sceneBody}>
              <View style={styles.timelineLine} />
              {visibleSegments.map((segment) => (
                <SegmentView
                  key={segment.id}
                  dimmed={
                    hasSelectedSegment && segment.id !== selectedSegmentId
                  }
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
  dimmedMarker: {
    backgroundColor: colors.divider,
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
});

