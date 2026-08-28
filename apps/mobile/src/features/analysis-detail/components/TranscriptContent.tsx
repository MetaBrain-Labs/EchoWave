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
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import type { AnalysisDetailView, TranscriptInvalidSegment, TranscriptSegment } from '../model';
import { Checkbox } from './AnalysisControls';
import { formatTime, showComingSoon } from './utils';

const emotionLabels: Record<string, string> = {
  neutral: '平静',
  happy: '愉快',
  angry: '生气',
  sad: '悲伤',
  anxious: '焦虑',
  excited: '兴奋',
  impatient: '不耐烦',
  frustrated: '沮丧',
  sarcastic: '讽刺',
  other: '其他',
  unknown: '未知',
};

export type TranscriptDisplayMode = 'current' | 'raw';

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
  displayMode,
  draftText,
  editing,
  dimmed,
  onDraftChange,
  onOpenAiTag,
  onOpenEmotion,
  onPlay,
  playbackDisabled,
  playbackLoading,
  playbackPlaying,
  segment,
  speakerDisplayName,
}: {
  displayMode: TranscriptDisplayMode;
  draftText?: string;
  editing: boolean;
  dimmed: boolean;
  onDraftChange: (segmentId: string, text: string) => void;
  onOpenAiTag: (segment: TranscriptSegment) => void;
  onOpenEmotion: (segment: TranscriptSegment) => void;
  onPlay: (segment: TranscriptSegment) => void;
  playbackDisabled: boolean;
  playbackLoading: boolean;
  playbackPlaying: boolean;
  segment: TranscriptSegment;
  speakerDisplayName: string;
}) {
  const identifiedRole = segment.roleAnalysis;
  const primaryIdentity = identifiedRole?.label ?? speakerDisplayName;
  const secondaryIdentity = identifiedRole
    ? `${speakerDisplayName} · 角色置信度 ${Math.round(identifiedRole.confidence * 100)}%`
    : segment.businessRole === 'unknown'
      ? '角色未知'
      : segment.businessRole;

  return (
    <View style={styles.segment} testID={`transcript-timeline-item-segment-${segment.id}`}>
      <View style={styles.segmentMain}>
        <View style={styles.speakerRow}>
          <Text style={[styles.speakerName, dimmed && styles.dimmedText]}>{primaryIdentity}</Text>
          <Text style={[styles.businessRole, dimmed && styles.dimmedText]}>
            {secondaryIdentity}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={segment.emotionAnalysis ? '查看情绪分析详情' : '情绪尚未分析'}
          accessibilityRole={segment.emotionAnalysis ? 'button' : 'text'}
          disabled={!segment.emotionAnalysis}
          onPress={() => onOpenEmotion(segment)}
          style={styles.emotionRow}
        >
          <Ionicons
            color={dimmed ? colors.muted : colors.secondary}
            name="happy-outline"
            size={typography.body.lineHeight}
          />
          <Text style={[styles.emotionText, dimmed && styles.dimmedText]}>
            {emotionLabels[segment.emotion] ?? segment.emotion}
          </Text>
          {segment.emotionAnalysis ? (
            <Ionicons color={colors.secondary} name="chevron-forward" size={16} />
          ) : null}
        </Pressable>
        <View style={styles.transcriptRow}>
          <Pressable
            accessibilityLabel={`${playbackPlaying ? '暂停' : '播放'}片段：${formatTime(segment.startSeconds)} 至 ${formatTime(segment.endSeconds)}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: playbackDisabled }}
            disabled={playbackDisabled}
            onPress={() => onPlay(segment)}
            style={({ pressed }) => [
              styles.segmentPlayButton,
              playbackDisabled && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {playbackLoading ? (
              <ActivityIndicator color={colors.ink} size="small" />
            ) : (
              <Ionicons color={colors.ink} name={playbackPlaying ? 'pause' : 'play'} size={18} />
            )}
          </Pressable>
          {editing ? (
            <TextInput
              accessibilityLabel={`${speakerDisplayName}的转写正文`}
              multiline
              onChangeText={(text) => onDraftChange(segment.id, text)}
              style={styles.transcriptInput}
              textAlignVertical="top"
              value={draftText ?? segment.text}
            />
          ) : (
            <Text style={[styles.transcriptText, dimmed && styles.dimmedText]}>
              {displayMode === 'raw' ? segment.rawText : segment.text}
            </Text>
          )}
        </View>
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

function InvalidSegmentView({ invalidSegment }: { invalidSegment: TranscriptInvalidSegment }) {
  return (
    <View
      accessibilityLabel={`已跳过 ${invalidSegment.durationSeconds} 秒无效片段`}
      accessible
      style={styles.invalidSegment}
      testID={`transcript-timeline-item-invalid-${invalidSegment.id}`}
    >
      <Ionicons
        color={colors.muted}
        name="volume-mute-outline"
        size={typography.description.lineHeight}
      />
      <Text style={styles.invalidSegmentText}>
        已跳过 {invalidSegment.durationSeconds} 秒无效片段
      </Text>
    </View>
  );
}

export function TranscriptContent({
  confirming,
  detail,
  displayMode,
  draftTexts,
  editing,
  hideIrrelevant,
  onCancelEditing,
  onConfirmEditing,
  onDisplayModeChange,
  onDraftChange,
  onOpenAiTag,
  onOpenEmotion,
  onPlaySegment,
  onStartEditing,
  playingSegmentId,
  segmentPlaybackDisabled,
  segmentPlaybackLoading,
  segmentPlaybackPlaying,
  selectedSegmentId,
}: {
  confirming: boolean;
  detail: AnalysisDetailView;
  displayMode: TranscriptDisplayMode;
  draftTexts: Readonly<Record<string, string>>;
  editing: boolean;
  hideIrrelevant: boolean;
  onCancelEditing: () => void;
  onConfirmEditing: () => void;
  onDisplayModeChange: (mode: TranscriptDisplayMode) => void;
  onDraftChange: (segmentId: string, text: string) => void;
  onOpenAiTag: (segment: TranscriptSegment) => void;
  onOpenEmotion: (segment: TranscriptSegment) => void;
  onPlaySegment: (segment: TranscriptSegment) => void;
  onStartEditing: () => void;
  playingSegmentId?: string;
  segmentPlaybackDisabled: boolean;
  segmentPlaybackLoading: boolean;
  segmentPlaybackPlaying: boolean;
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
  const speakerDisplayNames = new Map<string, string>();
  const confirmation = detail.transcriptConfirmation;
  for (const scene of detail.scenes) {
    for (const segment of scene.segments) {
      if (!speakerDisplayNames.has(segment.speakerKey)) {
        speakerDisplayNames.set(
          segment.speakerKey,
          detail.transcription.speakerIdentityScope === 'recording'
            ? segment.speakerKey
            : `发言 ${speakerDisplayNames.size + 1}`,
        );
      }
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.transcriptContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={styles.pageScroll}
    >
      <View accessibilityRole="summary" style={styles.confirmationCard}>
        <View style={styles.confirmationCopy}>
          <Text style={styles.confirmationTitle}>
            {confirmation.status === 'confirmed'
              ? `已确认转写 v${confirmation.currentVersion}`
              : '转写待确认'}
          </Text>
          <Text style={styles.confirmationDescription}>
            {confirmation.status === 'confirmed'
              ? `确认于 ${new Date(confirmation.confirmedAt).toLocaleString()}，后续分析使用当前确认版。`
              : '请检查正文并确认；确认前不能开始情绪分析或角色识别。'}
          </Text>
        </View>
        {!editing ? (
          <Pressable
            accessibilityRole="button"
            onPress={onStartEditing}
            style={({ pressed }) => [styles.confirmationAction, pressed && styles.pressed]}
          >
            <Text style={styles.confirmationActionText}>
              {confirmation.status === 'confirmed' ? '继续修正' : '编辑并确认'}
            </Text>
          </Pressable>
        ) : null}
        {confirmation.status === 'confirmed' && !editing ? (
          <View accessibilityRole="tablist" style={styles.versionSwitch}>
            {(['current', 'raw'] as const).map((mode) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: displayMode === mode }}
                key={mode}
                onPress={() => onDisplayModeChange(mode)}
                style={[styles.versionOption, displayMode === mode && styles.versionOptionActive]}
              >
                <Text
                  style={[
                    styles.versionOptionText,
                    displayMode === mode && styles.versionOptionTextActive,
                  ]}
                >
                  {mode === 'current' ? '当前确认版' : '原始转写'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {editing ? (
          <View style={styles.editActions}>
            <Pressable disabled={confirming} onPress={onCancelEditing} style={styles.editButton}>
              <Text style={styles.editCancelText}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={confirming}
              onPress={onConfirmEditing}
              style={[styles.editButton, styles.editConfirmButton]}
            >
              <Text style={styles.editConfirmText}>
                {confirming ? '正在确认…' : '确认整份转写'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {detail.transcription.diarizationStatus === 'not_returned' ? (
        <View
          accessibilityLabel="本次模型未返回说话人信息，以下使用匿名发言编号。"
          accessibilityRole="alert"
          accessible
          style={styles.diarizationNotice}
        >
          <Ionicons color={colors.secondary} name="people-outline" size={20} />
          <Text style={styles.diarizationNoticeText}>
            本次模型未返回说话人信息，以下使用匿名发言编号。
          </Text>
        </View>
      ) : null}
      {detail.transcription.speakerIdentityScope === 'chunk' ? (
        <View accessibilityRole="alert" style={styles.diarizationNotice}>
          <Ionicons color={colors.secondary} name="people-outline" size={20} />
          <Text style={styles.diarizationNoticeText}>
            本次结果只保证分块内的说话人身份，以下使用匿名发言编号，不代表跨块同一人。
          </Text>
        </View>
      ) : null}
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
      {visibleScenes.length === 0 && !skipInvalid && !hasSelectedSegment
        ? detail.invalidSegments.map((invalidSegment) => (
            <InvalidSegmentView invalidSegment={invalidSegment} key={invalidSegment.id} />
          ))
        : null}
      {visibleScenes.map((scene) => {
        const sceneIndex = detail.scenes.indexOf(scene);
        const visibleTimelineItems =
          hasSelectedSegment && hideIrrelevant
            ? scene.timelineItems.filter(
                (item) => item.kind === 'segment' && item.segment.id === selectedSegmentId,
              )
            : skipInvalid
              ? scene.timelineItems.filter((item) => item.kind === 'segment')
              : scene.timelineItems;

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
              {visibleTimelineItems.map((item) =>
                item.kind === 'invalid' ? (
                  <InvalidSegmentView invalidSegment={item.invalidSegment} key={item.id} />
                ) : (
                  <SegmentView
                    key={item.id}
                    displayMode={displayMode}
                    dimmed={hasSelectedSegment && item.segment.id !== selectedSegmentId}
                    draftText={draftTexts[item.segment.id]}
                    editing={editing}
                    onDraftChange={onDraftChange}
                    onOpenAiTag={onOpenAiTag}
                    onOpenEmotion={onOpenEmotion}
                    onPlay={onPlaySegment}
                    playbackDisabled={segmentPlaybackDisabled}
                    playbackLoading={segmentPlaybackLoading && playingSegmentId === item.segment.id}
                    playbackPlaying={segmentPlaybackPlaying && playingSegmentId === item.segment.id}
                    segment={item.segment}
                    speakerDisplayName={speakerDisplayNames.get(item.segment.speakerKey) ?? '发言'}
                  />
                ),
              )}
            </View>
          </View>
        );
      })}
      {editing ? (
        <View style={styles.bottomEditActions}>
          <Pressable disabled={confirming} onPress={onCancelEditing} style={styles.editButton}>
            <Text style={styles.editCancelText}>取消</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={confirming}
            onPress={onConfirmEditing}
            style={[styles.editButton, styles.editConfirmButton]}
          >
            <Text style={styles.editConfirmText}>{confirming ? '正在确认…' : '确认整份转写'}</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pressed: {
    backgroundColor: colors.background,
  },
  disabled: { opacity: 0.45 },
  pageScroll: {
    flex: 1,
  },
  transcriptContent: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  confirmationCard: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  confirmationCopy: { gap: spacing.xs },
  confirmationTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  confirmationDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  confirmationAction: { alignSelf: 'flex-end', padding: spacing.xs },
  confirmationActionText: {
    ...typography.heading5,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  versionSwitch: {
    alignSelf: 'flex-start',
    backgroundColor: colors.canvas,
    borderRadius: radii.default,
    flexDirection: 'row',
    padding: 2,
  },
  versionOption: { borderRadius: radii.default, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  versionOptionActive: { backgroundColor: colors.ink },
  versionOptionText: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  versionOptionTextActive: { color: colors.white, fontFamily: fontFamilies.sansBold },
  editActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  bottomEditActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.lg,
  },
  editButton: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    minWidth: 96,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  editConfirmButton: { backgroundColor: colors.ink, borderColor: colors.ink },
  editCancelText: { ...typography.heading5, color: textColors.primary, textAlign: 'center' },
  editConfirmText: { ...typography.heading5, color: colors.white, textAlign: 'center' },
  diarizationNotice: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  diarizationNoticeText: {
    ...typography.description,
    color: textColors.secondary,
    flex: 1,
    fontFamily: fontFamilies.sans,
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
    flex: 1,
  },
  transcriptRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segmentPlayButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.round,
    height: 36,
    justifyContent: 'center',
    marginTop: spacing.sm,
    width: 36,
  },
  transcriptInput: {
    ...typography.body,
    backgroundColor: colors.white,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    fontFamily: fontFamilies.kai,
    flex: 1,
    marginTop: spacing.sm,
    minHeight: 88,
    padding: spacing.sm,
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
