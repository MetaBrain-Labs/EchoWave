/**
 * 分析详情播放器。
 *
 * 呈现紧凑和展开两种播放器形态，并通过回调把播放状态交给页面持有。
 *
 * Responsibilities:
 * - 封装稳定的展示职责与局部交互。
 * - 页面级状态和导航仍由 AnalysisDetailScreen 统一协调。
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "@/shared/theme/tokens";
import { IconButton } from "./AnalysisControls";
import { formatTime, showComingSoon } from "./utils";

const waveformHeights = [
  8, 12, 17, 23, 14, 29, 19, 34, 22, 16, 27, 38, 25, 31, 18, 13, 24, 36,
  20, 28, 16, 33, 26, 14, 22, 30, 17, 25, 12, 20, 10, 16,
] as const;

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
          // 装饰波形顺序固定，因此索引可作为稳定渲染键。
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

export function CompactPlayer({
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

export function ExpandedPlayer({
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
});

