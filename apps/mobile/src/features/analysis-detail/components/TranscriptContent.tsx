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

import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import type {
  AiTagAnalysis,
  AnalysisDetailView,
  TranscriptInvalidSegment,
  TranscriptSegment,
  TranscriptTimelineItem,
} from '../model';
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
  hideReviewFindings,
  onDraftChange,
  onOpenAiTag,
  onOpenEmotion,
  onPlay,
  onPlayFinding,
  onResolveFinding,
  onSpeakerChange,
  onSplit,
  playbackDisabled,
  playbackLoading,
  playbackPlaying,
  reviewPlaybackAvailable,
  resolvingReviewFinding,
  segment,
  speakerDisplayName,
  speakerOptions,
}: {
  displayMode: TranscriptDisplayMode;
  draftText?: string;
  editing: boolean;
  dimmed: boolean;
  hideReviewFindings: boolean;
  onDraftChange: (segmentId: string, text: string) => void;
  onOpenAiTag: (tag: AiTagAnalysis) => void;
  onOpenEmotion: (segment: TranscriptSegment) => void;
  onPlay: (segment: TranscriptSegment) => void;
  onPlayFinding: (segment: TranscriptSegment, splitAfterWordIndex: number) => void;
  onResolveFinding: (findingId: string) => void;
  onSpeakerChange: (segmentId: string, speakerKey: string) => void;
  onSplit: (segment: TranscriptSegment, splitAfterWordIndex: number) => void;
  playbackDisabled: boolean;
  playbackLoading: boolean;
  playbackPlaying: boolean;
  reviewPlaybackAvailable: boolean;
  resolvingReviewFinding?: string;
  segment: TranscriptSegment;
  speakerDisplayName: string;
  speakerOptions: readonly string[];
}) {
  const [reviewIndex, setReviewIndex] = useState(0);
  const identifiedRole = segment.roleAnalysis;
  const primaryIdentity = identifiedRole?.label ?? speakerDisplayName;
  const secondaryIdentity = identifiedRole
    ? `${speakerDisplayName} · 角色置信度 ${Math.round(identifiedRole.confidence * 100)}%`
    : segment.businessRole === 'unknown'
      ? '角色未知'
      : segment.businessRole;
  const reviewFindings = hideReviewFindings
    ? []
    : [...segment.reviewFindings]
        .filter((finding) => finding.splitAfterWordIndex !== null)
        .sort((left, right) =>
          left.severity === right.severity ? 0 : left.severity === 'high' ? -1 : 1,
        );
  const activeReviewIndex = Math.min(reviewIndex, Math.max(0, reviewFindings.length - 1));
  const primaryReviewFinding = reviewFindings[activeReviewIndex];
  const additionalReviewFindingCount = Math.max(0, reviewFindings.length - 1);

  return (
    <View style={styles.segment} testID={`transcript-timeline-item-segment-${segment.id}`}>
      <View style={styles.segmentMain}>
        <View style={styles.speakerRow}>
          <Text style={[styles.speakerName, dimmed && styles.dimmedText]}>{primaryIdentity}</Text>
          <Text style={[styles.businessRole, dimmed && styles.dimmedText]}>
            {secondaryIdentity}
          </Text>
        </View>
        {editing ? (
          <ScrollView
            contentContainerStyle={styles.speakerOptions}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {speakerOptions.map((speakerKey) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: segment.speakerKey === speakerKey }}
                key={speakerKey}
                onPress={() => onSpeakerChange(segment.id, speakerKey)}
                style={[
                  styles.speakerOption,
                  segment.speakerKey === speakerKey && styles.speakerOptionSelected,
                ]}
              >
                <Text
                  style={[
                    styles.speakerOptionText,
                    segment.speakerKey === speakerKey && styles.speakerOptionTextSelected,
                  ]}
                >
                  {speakerKey}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
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
        {primaryReviewFinding
          ? (() => {
              const finding = primaryReviewFinding;
              const boundary = finding.splitAfterWordIndex!;
              const canSplit =
                editing &&
                segment.words.length > 1 &&
                boundary >= segment.startWordIndex &&
                boundary + 1 < segment.endWordIndex;
              return (
                <View
                  key={finding.id}
                  style={[
                    styles.reviewFindingStack,
                    additionalReviewFindingCount > 0 && styles.reviewFindingStackMultiple,
                  ]}
                >
                  {additionalReviewFindingCount > 0 ? (
                    <>
                      <View style={[styles.reviewFindingLayer, styles.reviewFindingLayerBack]} />
                      <View style={styles.reviewFindingLayer} />
                    </>
                  ) : null}
                  <View style={styles.reviewFinding}>
                    <View style={styles.reviewFindingHeader}>
                      <Text style={styles.reviewBadge}>说话人待确认</Text>
                      <Text style={styles.reviewSeverity}>
                        {finding.severity === 'high' ? '高疑点' : '中疑点'}
                      </Text>
                      {additionalReviewFindingCount > 0 ? (
                        <Text
                          accessibilityLabel={`还有 ${additionalReviewFindingCount} 个说话人疑点`}
                          style={styles.reviewCount}
                        >
                          +{additionalReviewFindingCount}
                        </Text>
                      ) : null}
                    </View>
                    {reviewFindings.length > 1 ? (
                      <View style={styles.reviewPagination}>
                        <Pressable
                          accessibilityLabel="上一个说话人疑点"
                          accessibilityRole="button"
                          onPress={() =>
                            setReviewIndex(
                              (activeReviewIndex - 1 + reviewFindings.length) %
                                reviewFindings.length,
                            )
                          }
                          style={styles.reviewPageButton}
                        >
                          <Ionicons color={colors.secondary} name="chevron-back" size={16} />
                        </Pressable>
                        <Text style={styles.reviewPageText}>
                          {activeReviewIndex + 1} / {reviewFindings.length}
                        </Text>
                        <Pressable
                          accessibilityLabel="下一个说话人疑点"
                          accessibilityRole="button"
                          onPress={() =>
                            setReviewIndex((activeReviewIndex + 1) % reviewFindings.length)
                          }
                          style={styles.reviewPageButton}
                        >
                          <Ionicons color={colors.secondary} name="chevron-forward" size={16} />
                        </Pressable>
                      </View>
                    ) : null}
                    <Text style={styles.reviewReason}>{finding.explanation}</Text>
                    <View style={styles.reviewActions}>
                      {reviewPlaybackAvailable ? (
                        <Pressable
                          onPress={() => onPlayFinding(segment, boundary)}
                          style={styles.reviewAction}
                        >
                          <Text style={styles.reviewActionText}>播放边界前后</Text>
                        </Pressable>
                      ) : null}
                      {canSplit ? (
                        <Pressable
                          onPress={() => onSplit(segment, boundary)}
                          style={styles.reviewAction}
                        >
                          <Text style={styles.reviewActionText}>在此拆段</Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        disabled={Boolean(resolvingReviewFinding)}
                        onPress={() => onResolveFinding(finding.id)}
                        style={[styles.reviewAction, resolvingReviewFinding && styles.disabled]}
                      >
                        <Text style={styles.reviewActionText}>
                          {resolvingReviewFinding === finding.id ? '正在审核…' : '确认无误'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })()
          : null}
      </View>
      <View style={styles.segmentRail} testID={`timeline-rail-${segment.id}`}>
        {segment.aiTags.map((tag) => (
          <Pressable
            accessibilityLabel={`查看 AI 标签：${tag.title}`}
            accessibilityRole="button"
            key={tag.id}
            onPress={() => onOpenAiTag(tag)}
            style={({ pressed }) => [styles.aiTagButton, pressed && styles.pressed]}
            testID={`ai-tag-timeline-marker-${segment.id}-${tag.id}`}
          >
            <Text numberOfLines={2} style={[styles.aiTagText, dimmed && styles.dimmedText]}>
              {tag.customLabel ?? tag.title}
            </Text>
            <View style={styles.aiTagNode}>
              <Ionicons
                color={dimmed ? colors.muted : colors.success}
                name="sparkles"
                size={typography.label.lineHeight}
              />
            </View>
          </Pressable>
        ))}
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
  draftSegments,
  editing,
  hideIrrelevant,
  onCancelEditing,
  onConfirmEditing,
  onDisplayModeChange,
  onDraftChange,
  onOpenAiTag,
  onOpenEmotion,
  onPlaySegment,
  onPlayReviewFinding,
  onResolveAllReviewFindings,
  onResolveReviewFinding,
  onRefresh = () => undefined,
  onSpeakerChange,
  onSplitSegment,
  onStartEditing,
  playingSegmentId,
  resolvingReviewFinding,
  refreshing = false,
  segmentPlaybackDisabled,
  segmentPlaybackLoading,
  segmentPlaybackPlaying,
  reviewPlaybackAvailable,
  selectedSegmentIds,
}: {
  confirming: boolean;
  detail: AnalysisDetailView;
  displayMode: TranscriptDisplayMode;
  draftSegments: readonly TranscriptSegment[];
  editing: boolean;
  hideIrrelevant: boolean;
  onCancelEditing: () => void;
  onConfirmEditing: () => void;
  onDisplayModeChange: (mode: TranscriptDisplayMode) => void;
  onDraftChange: (segmentId: string, text: string) => void;
  onOpenAiTag: (tag: AiTagAnalysis) => void;
  onOpenEmotion: (segment: TranscriptSegment) => void;
  onPlaySegment: (segment: TranscriptSegment) => void;
  onPlayReviewFinding: (segment: TranscriptSegment, splitAfterWordIndex: number) => void;
  onResolveAllReviewFindings: () => void;
  onResolveReviewFinding: (findingId: string) => void;
  onRefresh?: () => void;
  onSpeakerChange: (segmentId: string, speakerKey: string) => void;
  onSplitSegment: (segment: TranscriptSegment, splitAfterWordIndex: number) => void;
  onStartEditing: () => void;
  playingSegmentId?: string;
  resolvingReviewFinding?: string;
  refreshing?: boolean;
  segmentPlaybackDisabled: boolean;
  segmentPlaybackLoading: boolean;
  segmentPlaybackPlaying: boolean;
  reviewPlaybackAvailable: boolean;
  selectedSegmentIds: readonly string[];
}) {
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [hideSpeakerReview, setHideSpeakerReview] = useState(false);
  const pendingReviewFindingCount = detail.speakerReview.findings.filter(
    (finding) => finding.sourceSegmentId !== null && finding.splitAfterWordIndex !== null,
  ).length;
  const selectedIds = new Set(selectedSegmentIds);
  const hasSelectedTag = selectedIds.size > 0;
  const selectedScenes = displayMode === 'raw' && !editing ? detail.rawScenes : detail.scenes;
  const displayScenes = editing
    ? selectedScenes.map((scene) => {
        const emittedSources = new Set<string>();
        const timelineItems = scene.timelineItems.flatMap<TranscriptTimelineItem>((item) => {
          if (item.kind === 'invalid') return [item];
          if (emittedSources.has(item.segment.sourceSegmentId)) return [];
          emittedSources.add(item.segment.sourceSegmentId);
          return draftSegments
            .filter((segment) => segment.sourceSegmentId === item.segment.sourceSegmentId)
            .map((segment) => ({ id: segment.id, kind: 'segment' as const, segment }));
        });
        return {
          ...scene,
          segments: timelineItems.flatMap((item) =>
            item.kind === 'segment' ? [item.segment] : [],
          ),
          timelineItems,
        };
      })
    : selectedScenes;
  const visibleScenes =
    hasSelectedTag && hideIrrelevant
      ? displayScenes.filter((scene) =>
          scene.segments.some((segment) => selectedIds.has(segment.id)),
        )
      : displayScenes;
  const speakerDisplayNames = new Map<string, string>();
  const confirmation = detail.transcriptConfirmation;
  for (const scene of displayScenes) {
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
  const assignedSpeakerKeys = [...new Set(draftSegments.map((segment) => segment.speakerKey))];
  const nextSpeakerNumber =
    assignedSpeakerKeys.reduce((maximum, speakerKey) => {
      const match = /^Speaker (\d+)$/.exec(speakerKey);
      return Math.max(maximum, match ? Number(match[1]) : 0);
    }, 0) + 1;
  const speakerOptions = [...assignedSpeakerKeys, `Speaker ${nextSpeakerNumber}`];
  const rawSpeakerCount = new Set(
    detail.rawScenes.flatMap((scene) => scene.segments.map((segment) => segment.speakerKey)),
  ).size;
  const systemConfirmed =
    confirmation.status === 'confirmed' && confirmation.origin === 'system_raw_snapshot';

  return (
    <ScrollView
      alwaysBounceVertical
      contentContainerStyle={styles.transcriptContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={<ScreenRefreshControl onRefresh={onRefresh} refreshing={refreshing} />}
      showsVerticalScrollIndicator={false}
      style={styles.pageScroll}
    >
      <View accessibilityRole="summary" style={styles.confirmationCard}>
        <View style={styles.confirmationCopy}>
          <Text style={styles.confirmationTitle}>
            {confirmation.status === 'confirmed'
              ? systemConfirmed
                ? `轻量本地已自动确认 v${confirmation.currentVersion}`
                : `已确认转写 v${confirmation.currentVersion}`
              : '转写待确认'}
          </Text>
          <Text style={styles.confirmationDescription}>
            {confirmation.status === 'confirmed'
              ? systemConfirmed
                ? '转写完成后已自动生成确认快照，后续分析可直接使用；如需调整可继续修正。'
                : `确认于 ${new Date(confirmation.confirmedAt).toLocaleString()}，后续分析使用当前确认版。`
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
      {rawSpeakerCount === 1 ? (
        <View accessibilityRole="alert" style={styles.diarizationNotice}>
          <Ionicons color={colors.secondary} name="person-outline" size={20} />
          <Text style={styles.diarizationNoticeText}>本录音仅识别到 1 位说话人。</Text>
        </View>
      ) : null}
      {detail.speakerReview.resolvedAt ? (
        <View accessibilityRole="alert" style={styles.diarizationNotice}>
          <Ionicons color={colors.success} name="checkmark-circle-outline" size={20} />
          <Text style={styles.diarizationNoticeText}>说话人复核已完成，所有疑点均已审核通过。</Text>
        </View>
      ) : detail.speakerReview.status === 'partial' ? (
        <View accessibilityRole="alert" style={styles.diarizationNotice}>
          <Ionicons color={colors.secondary} name="alert-circle-outline" size={20} />
          <Text style={styles.diarizationNoticeText}>
            智能说话人复核未完成。{detail.speakerReview.message ?? '已保留本地规则检测结果。'}
          </Text>
        </View>
      ) : null}
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
        {pendingReviewFindingCount > 0 ? (
          <Checkbox
            checked={hideSpeakerReview}
            label="屏蔽说话人待确认"
            onPress={() => setHideSpeakerReview((value) => !value)}
          />
        ) : null}
        {pendingReviewFindingCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(resolvingReviewFinding)}
            onPress={onResolveAllReviewFindings}
            style={[styles.resolveAllButton, resolvingReviewFinding && styles.disabled]}
          >
            <Ionicons color={colors.secondary} name="checkmark-done-outline" size={18} />
            <Text style={styles.resolveAllButtonText}>
              {resolvingReviewFinding === 'all' ? '正在审核…' : '全部审核通过'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {visibleScenes.every((scene) => scene.segments.length === 0) ? (
        <View style={styles.emptyTranscript}>
          <Text style={styles.emptyTranscriptText}>未识别到可转写的语音内容。</Text>
        </View>
      ) : null}
      {visibleScenes.length === 0 && !skipInvalid && !hasSelectedTag
        ? detail.invalidSegments.map((invalidSegment) => (
            <InvalidSegmentView invalidSegment={invalidSegment} key={invalidSegment.id} />
          ))
        : null}
      {visibleScenes.map((scene) => {
        const sceneIndex = displayScenes.indexOf(scene);
        const visibleTimelineItems =
          hasSelectedTag && hideIrrelevant
            ? scene.timelineItems.filter(
                (item) => item.kind === 'segment' && selectedIds.has(item.segment.id),
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
                    dimmed={hasSelectedTag && !selectedIds.has(item.segment.id)}
                    draftText={item.segment.text}
                    editing={editing}
                    hideReviewFindings={hideSpeakerReview}
                    onDraftChange={onDraftChange}
                    onOpenAiTag={onOpenAiTag}
                    onOpenEmotion={onOpenEmotion}
                    onPlay={onPlaySegment}
                    onPlayFinding={onPlayReviewFinding}
                    onResolveFinding={onResolveReviewFinding}
                    onSpeakerChange={onSpeakerChange}
                    onSplit={onSplitSegment}
                    playbackDisabled={segmentPlaybackDisabled}
                    playbackLoading={segmentPlaybackLoading && playingSegmentId === item.segment.id}
                    playbackPlaying={segmentPlaybackPlaying && playingSegmentId === item.segment.id}
                    reviewPlaybackAvailable={reviewPlaybackAvailable}
                    resolvingReviewFinding={resolvingReviewFinding}
                    segment={item.segment}
                    speakerDisplayName={speakerDisplayNames.get(item.segment.speakerKey) ?? '发言'}
                    speakerOptions={speakerOptions}
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
  resolveAllButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.xs,
  },
  resolveAllButtonText: {
    ...typography.heading5,
    color: colors.secondary,
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
    gap: spacing.sm,
    justifyContent: 'center',
    width: 96,
  },
  speakerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  speakerOptions: { gap: spacing.xs, paddingVertical: spacing.xs },
  speakerOption: {
    borderColor: colors.divider,
    borderRadius: radii.round,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  speakerOptionSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  speakerOptionText: { ...typography.label, color: textColors.secondary },
  speakerOptionTextSelected: { color: colors.white },
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
    width: '100%',
  },
  aiTagNode: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    height: typography.label.lineHeight,
    justifyContent: 'center',
    flexShrink: 0,
    width: typography.label.lineHeight,
  },
  aiTagText: {
    ...typography.label,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    minWidth: 0,
    textAlign: 'right',
    textDecorationLine: 'underline',
  },
  segmentTime: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  reviewFindingStack: { marginTop: spacing.sm, position: 'relative' },
  reviewFindingStackMultiple: { paddingBottom: 8, paddingRight: 8 },
  reviewFindingLayer: {
    backgroundColor: colors.canvas,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    bottom: 4,
    left: 4,
    position: 'absolute',
    right: 4,
    top: 4,
  },
  reviewFindingLayerBack: { bottom: 0, left: 8, right: 0, top: 8 },
  reviewFinding: {
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  reviewFindingHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  reviewBadge: {
    ...typography.label,
    backgroundColor: colors.canvas,
    borderRadius: radii.round,
    color: textColors.primary,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  reviewSeverity: { ...typography.description, color: textColors.secondary },
  reviewCount: {
    ...typography.label,
    backgroundColor: colors.secondary,
    borderRadius: radii.round,
    color: colors.white,
    marginLeft: 'auto',
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  reviewPagination: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  reviewPageButton: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    borderRadius: radii.round,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  reviewPageText: {
    ...typography.label,
    color: textColors.secondary,
    minWidth: 36,
    textAlign: 'center',
  },
  reviewReason: { ...typography.description, color: textColors.secondary },
  reviewActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reviewAction: { paddingVertical: spacing.xs },
  reviewActionText: { ...typography.label, color: colors.secondary },
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
