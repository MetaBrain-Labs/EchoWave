/**
 * 数据源音频行。
 *
 * 展示单条音频及上传、转写、分析状态。
 *
 * Responsibilities:
 * - 恢复可访问的状态说明、进度和播放操作
 *
 * Notes:
 * - 仅渲染 feature 数据并通过回调上报操作，不访问网络或路由。
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

import { audioTranscriptionStageLabel } from './AudioTranscriptionProgressDialog';
import type { SourceAudioItem, SourceAudioStatus } from '../model';

function AudioStatusView({
  onShowError,
  onShowProgress,
  status,
}: {
  onShowError: () => void;
  onShowProgress: () => void;
  status: SourceAudioStatus;
}) {
  switch (status.kind) {
    case 'complete':
      return null;
    case 'uploading':
      return (
        <View style={styles.inlineStatus}>
          <ActivityIndicator color={colors.ink} size={typography.body.lineHeight} />
          <Text style={styles.statusText}>上传中</Text>
        </View>
      );
    case 'transcribing':
      return (
        <Pressable
          accessibilityLabel="查看转写进度"
          accessibilityRole="button"
          onPress={onShowProgress}
          style={({ pressed }) => [styles.processingStatus, pressed && styles.pressed]}
        >
          <View style={styles.processingTitleRow}>
            <Text numberOfLines={1} style={styles.processingTitle}>
              {status.activity
                ? `${audioTranscriptionStageLabel(status.activity.stage)}${['transcribing', 'validating', 'splitting'].includes(status.activity.stage) && status.activity.chunkIndex !== null ? ` · Chunk ${status.activity.chunkIndex}/${status.activity.chunkCount}` : ''}`
                : '正在转写'}
            </Text>
            <Text style={styles.processingPercent}>{status.progress}%</Text>
          </View>
          <View style={styles.processingProgressTrack}>
            <View
              style={[
                styles.processingProgressFill,
                { width: `${Math.min(100, status.progress)}%` },
              ]}
            />
          </View>
          <Text numberOfLines={1} style={styles.processingAttempts}>
            {status.activity?.networkAttempt !== null &&
            status.activity?.networkAttempt !== undefined
              ? `网络尝试 ${status.activity.networkAttempt}/3`
              : '点击查看详细执行阶段'}
          </Text>
        </Pressable>
      );
    case 'waiting':
      return (
        <View style={styles.inlineStatus}>
          <Ionicons color={colors.ink} name="hourglass-outline" size={typography.body.lineHeight} />
          <Text style={styles.statusText}>待转写</Text>
        </View>
      );
    case 'upload-failed':
      return (
        <View accessibilityRole="alert" style={styles.inlineStatus}>
          <Ionicons
            color={colors.ink}
            name="alert-circle-outline"
            size={typography.body.lineHeight}
          />
          <Text style={styles.failureStatusText}>上传失败</Text>
        </View>
      );
    case 'transcription-failed':
      return (
        <Pressable
          accessibilityLabel="查看转写失败详情"
          accessibilityRole="button"
          onPress={onShowError}
          style={({ pressed }) => [styles.inlineStatus, pressed && styles.pressed]}
        >
          <Ionicons
            color={colors.ink}
            name="alert-circle-outline"
            size={typography.body.lineHeight}
          />
          <Text style={styles.failureStatusText}>转写失败</Text>
        </Pressable>
      );
  }
}

export function AudioRow({
  active,
  item,
  loading,
  onMore,
  onPlay,
  onShowError,
  onShowProgress,
  playing,
}: {
  active: boolean;
  item: SourceAudioItem;
  loading: boolean;
  onMore: () => void;
  onPlay: () => void;
  onShowError: () => void;
  onShowProgress: () => void;
  playing: boolean;
}) {
  const playbackDisabled =
    item.status.kind === 'uploading' ||
    item.status.kind === 'upload-failed' ||
    item.sourceState === 'cleaned' ||
    item.sourceState === 'missing';
  return (
    <View style={styles.audioRow}>
      <Pressable
        accessibilityLabel={`${active && playing ? '暂停' : '播放'}音频：${item.title}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: playbackDisabled }}
        disabled={playbackDisabled}
        onPress={onPlay}
        style={({ pressed }) => [
          styles.playButton,
          playbackDisabled && styles.disabledButton,
          pressed && styles.pressed,
        ]}
      >
        {active && loading ? (
          <ActivityIndicator color={colors.secondary} />
        ) : (
          <Ionicons
            color={colors.secondary}
            name={active && playing ? 'pause' : 'play'}
            size={typography.heading1.lineHeight}
          />
        )}
      </Pressable>
      <View style={styles.audioMain}>
        <Text numberOfLines={1} style={styles.audioTitle}>
          {item.title}
        </Text>
        <Text style={styles.audioMeta}>
          {item.duration} · {item.createdAt}
        </Text>
        {item.sourceRecoveryState === 'required' ? (
          <Text style={styles.sourceWarning}>重新运行前需要重新选择原音频</Text>
        ) : item.sourceState && item.sourceState !== 'available' ? (
          <Text style={styles.sourceWarning}>源音频未保留</Text>
        ) : item.runtimeMode === 'object_storage' && item.sourceDeleteAfter ? (
          <Text style={styles.sourceWarning}>
            原音频保留至 {new Date(item.sourceDeleteAfter).toLocaleDateString()}
          </Text>
        ) : null}
        <AudioStatusView
          onShowError={onShowError}
          onShowProgress={onShowProgress}
          status={item.status}
        />
      </View>
      <Pressable
        accessibilityLabel={`${item.title}更多操作`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onMore}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
      >
        <Ionicons color={colors.ink} name="ellipsis-vertical" size={24} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sourceWarning: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  inlineStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginLeft: spacing.sm,
  },
  statusText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  processingStatus: {
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  pressed: { backgroundColor: colors.divider, borderRadius: radii.default },
  processingTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  processingTitle: {
    ...typography.description,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
  },
  processingPercent: {
    ...typography.label,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  processingProgressTrack: {
    backgroundColor: colors.divider,
    borderRadius: radii.round,
    height: 4,
    overflow: 'hidden',
  },
  processingProgressFill: {
    backgroundColor: colors.ink,
    borderRadius: radii.round,
    height: '100%',
  },
  processingAttempts: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  failureStatusText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  audioRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 84,
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.round,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  disabledButton: { opacity: 0.4 },
  audioMain: { flex: 1, gap: spacing.xs, marginLeft: spacing.base },
  audioTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  audioMeta: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  moreButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    marginLeft: spacing.sm,
    width: 28,
  },
});
