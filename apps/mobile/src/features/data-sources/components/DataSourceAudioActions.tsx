/**
 * 数据源音频操作抽屉。
 *
 * 为近期音频和完整音频列表提供一致的归档、ASR 转写与结果查看入口，并在任务状态
 * 不允许操作时保留可理解的禁用表达。
 *
 * Responsibilities:
 * - 跨 iOS、Android 和 Web 呈现三个稳定操作项。
 * - 将业务动作回传给数据源详情编排器。
 *
 * Notes:
 * - 二次确认、网络请求和导航不在本组件内执行。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

import type { SourceAudioItem } from '../model';

function ActionItem({
  destructive = false,
  disabled = false,
  icon,
  label,
  onPress,
}: {
  destructive?: boolean;
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={destructive ? colors.ink : colors.secondary} name={icon} size={22} />
      <Text style={[styles.actionText, destructive && styles.destructiveText]}>{label}</Text>
    </Pressable>
  );
}

/** 渲染单条音频的三项操作抽屉。 */
export function DataSourceAudioActions({
  audio,
  onAnalysis,
  onArchive,
  onClose,
  onTranscribe,
}: {
  audio?: SourceAudioItem;
  onAnalysis: () => void;
  onArchive: () => void;
  onClose: () => void;
  onTranscribe: () => void;
}) {
  const processing = audio?.status.kind === 'uploading' || audio?.status.kind === 'transcribing';
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={Boolean(audio)}>
      <Pressable accessibilityLabel="关闭音频操作" onPress={onClose} style={styles.backdrop} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {audio?.title ?? ''}
        </Text>
        <ActionItem
          destructive
          disabled={processing}
          icon="archive-outline"
          label="归档"
          onPress={onArchive}
        />
        <ActionItem
          disabled={processing}
          icon="document-text-outline"
          label="ASR转写"
          onPress={onTranscribe}
        />
        <ActionItem
          disabled={!audio?.hasTranscript}
          icon="analytics-outline"
          label="ASR结果分析"
          onPress={onAnalysis}
        />
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(16, 24, 40, 0.28)', flex: 1 },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  title: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    paddingBottom: spacing.sm,
  },
  action: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 52,
  },
  actionText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  destructiveText: { fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  disabled: { opacity: 0.35 },
  pressed: { backgroundColor: colors.background },
  cancel: { alignItems: 'center', minHeight: 48, paddingTop: spacing.md },
  cancelText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
});
