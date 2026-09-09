/**
 * 分析详情播放器。
 *
 * 呈现紧凑和展开两种播放器形态，并通过回调把播放状态交给页面持有。
 *
 * Responsibilities:
 * - 封装稳定的展示职责与局部交互。
 * - 页面级状态和导航仍由 AnalysisDetailScreen 统一协调。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { IconButton } from './AnalysisControls';
import { formatTime, showComingSoon } from './utils';

const waveformHeights = [
  8, 12, 17, 23, 14, 29, 19, 34, 22, 16, 27, 38, 25, 31, 18, 13, 24, 36, 20, 28, 16, 33, 26, 14, 22,
  30, 17, 25, 12, 20, 10, 16,
] as const;

function Waveform({
  expanded = false,
  onSeek,
  progress,
}: {
  expanded?: boolean;
  onSeek?: (progress: number) => void;
  progress: number;
}) {
  const { t } = useAppLanguage();
  const [waveformWidth, setWaveformWidth] = useState(0);
  const waveform = (
    <>
      <View
        style={[styles.waveformProgress, { width: `${Math.min(1, Math.max(0, progress)) * 100}%` }]}
      />
      <View
        style={[styles.waveformCursor, { left: `${Math.min(1, Math.max(0, progress)) * 100}%` }]}
      />
      {waveformHeights.map((height, index) => (
        <View
          // 装饰波形顺序固定，因此索引可作为稳定渲染键。
          key={index}
          style={[
            styles.waveformBar,
            expanded && styles.expandedWaveformBar,
            { height: expanded ? height + 4 : Math.max(4, Math.round(height / 2)) },
          ]}
        />
      ))}
    </>
  );
  if (onSeek) {
    return (
      <Pressable
        accessibilityLabel={t('player.seek')}
        accessibilityRole="button"
        onLayout={(event) => setWaveformWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          if (waveformWidth > 0) onSeek(event.nativeEvent.locationX / waveformWidth);
        }}
        style={[styles.waveform, expanded && styles.expandedWaveform]}
      >
        {waveform}
      </Pressable>
    );
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.waveform, expanded && styles.expandedWaveform]}
    >
      {waveform}
    </View>
  );
}

export function CompactPlayer({
  durationSeconds,
  error,
  isBuffering,
  isLoaded,
  isPlaying,
  onBack,
  onExpand,
  onPlayPause,
  onRetry,
  positionSeconds,
}: {
  durationSeconds: number;
  error?: string;
  isBuffering: boolean;
  isLoaded: boolean;
  isPlaying: boolean;
  onBack: () => void;
  onExpand: () => void;
  onPlayPause: () => void;
  onRetry: () => void;
  positionSeconds: number;
}) {
  const { t } = useAppLanguage();
  return (
    <View style={styles.compactHeader}>
      <IconButton icon="chevron-back" label={t('common.back')} onPress={onBack} />
      <View style={styles.compactPlayer}>
        <Pressable
          accessibilityLabel={isPlaying ? t('player.pauseAudio') : t('player.playAudio')}
          accessibilityRole="button"
          disabled={!isLoaded || Boolean(error)}
          onPress={onPlayPause}
          style={({ pressed }) => [
            styles.compactPlayButton,
            (!isLoaded || error) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {isBuffering || !isLoaded ? (
            <ActivityIndicator color={colors.ink} size="small" />
          ) : (
            <Ionicons color={colors.ink} name={isPlaying ? 'pause' : 'play'} size={22} />
          )}
        </Pressable>
        <Pressable
          accessibilityLabel={t('player.expand')}
          accessibilityRole="button"
          onPress={onExpand}
          style={({ pressed }) => [styles.compactWaveformButton, pressed && styles.pressed]}
        >
          <Waveform progress={durationSeconds > 0 ? positionSeconds / durationSeconds : 0} />
        </Pressable>
        {error ? (
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text numberOfLines={1} style={styles.playerError}>
              {t('player.loadRetry')}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.playerTime}>
            {formatTime(positionSeconds)} / {formatTime(durationSeconds)}
          </Text>
        )}
      </View>
      <IconButton
        icon="ellipsis-horizontal"
        label={t('common.moreActions')}
        onPress={() => showComingSoon(t('common.moreActions'))}
      />
    </View>
  );
}

export function ExpandedPlayer({
  durationSeconds,
  error,
  isBuffering,
  isLoaded,
  isPlaying,
  onBack,
  onCollapse,
  onJump,
  onPlayPause,
  onRateChange,
  onRetry,
  onSeek,
  playbackRate,
  positionSeconds,
}: {
  durationSeconds: number;
  error?: string;
  isBuffering: boolean;
  isLoaded: boolean;
  isPlaying: boolean;
  onBack: () => void;
  onCollapse: () => void;
  onJump: (seconds: number) => void;
  onPlayPause: () => void;
  onRateChange: () => void;
  onRetry: () => void;
  onSeek: (seconds: number) => void;
  playbackRate: number;
  positionSeconds: number;
}) {
  const { t } = useAppLanguage();
  return (
    <View style={styles.expandedPlayerContainer}>
      <View style={styles.expandedTopBar}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={onBack} />
        <IconButton
          icon="ellipsis-horizontal"
          label={t('common.moreActions')}
          onPress={() => showComingSoon(t('common.moreActions'))}
        />
      </View>
      <View style={styles.largeWaveformArea}>
        <Waveform
          expanded
          onSeek={(progress) => onSeek(progress * durationSeconds)}
          progress={durationSeconds > 0 ? positionSeconds / durationSeconds : 0}
        />
      </View>
      <View style={styles.expandedTimeRow}>
        <Text style={styles.playerTime}>{formatTime(positionSeconds)}</Text>
        <Text style={styles.playerTime}>{formatTime(durationSeconds)}</Text>
      </View>
      <View style={styles.playerControls}>
        <Pressable
          accessibilityLabel={t('player.rate', { rate: playbackRate.toFixed(1) })}
          accessibilityRole="button"
          onPress={onRateChange}
          style={({ pressed }) => [styles.controlButton, pressed && styles.pressed]}
        >
          <Text style={styles.controlText}>x{playbackRate.toFixed(1)}</Text>
        </Pressable>
        <IconButton icon="play-back" label={t('player.rewind')} onPress={() => onJump(-15)} />
        <Pressable
          accessibilityLabel={isPlaying ? t('player.pauseAudio') : t('player.playAudio')}
          accessibilityRole="button"
          onPress={onPlayPause}
          disabled={!isLoaded || Boolean(error)}
          style={({ pressed }) => [
            styles.largePlayButton,
            (!isLoaded || error) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {isBuffering || !isLoaded ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Ionicons color={colors.ink} name={isPlaying ? 'pause' : 'play'} size={36} />
          )}
        </Pressable>
        <IconButton icon="play-forward" label={t('player.forward')} onPress={() => onJump(15)} />
        <IconButton icon="contract-outline" label={t('player.collapse')} onPress={onCollapse} />
      </View>
      {error ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.expandedError}>
          <Text style={styles.playerError}>{t('player.errorRetry', { error })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  compactHeader: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 88,
    paddingHorizontal: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.background,
  },
  disabled: { opacity: 0.45 },
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
    overflow: 'hidden',
    position: 'relative',
  },
  expandedWaveform: {
    height: 52,
  },
  waveformCursor: {
    backgroundColor: '#ff5964',
    height: '100%',
    position: 'absolute',
    top: 0,
    width: 2,
    zIndex: 2,
  },
  waveformProgress: {
    backgroundColor: colors.background,
    bottom: 0,
    left: 0,
    opacity: 0.55,
    position: 'absolute',
    top: 0,
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
  playerError: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  expandedError: { alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
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
});
