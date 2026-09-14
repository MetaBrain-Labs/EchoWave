/**
 * 跨平台操作抽屉。
 *
 * Responsibilities:
 * - 复用项目单列画布、三色文字与触控区域。
 * - 由业务调用方管理确认、版本冲突和失败重试。
 * Notes:
 * - 不依赖任何功能模块。
 */
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 动作失败时保持打开，调用方明确决定何时关闭。 */
export function ActionSheet({
  title,
  visible,
  onClose,
  closeLabel,
  actions,
  message,
  busy = false,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  closeLabel: string;
  message?: string;
  busy?: boolean;
  actions: Array<{
    label: string;
    onPress: () => void;
    icon?: keyof typeof Ionicons.glyphMap;
    disabled?: boolean;
  }>;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          disabled={busy}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {message ? (
              <Text accessibilityRole="alert" style={styles.message}>
                {message}
              </Text>
            ) : null}
            {actions.map((action) => (
              <Pressable
                key={action.label}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityState={{ disabled: busy || action.disabled }}
                disabled={busy || action.disabled}
                onPress={action.onPress}
                style={styles.action}
              >
                {action.icon ? (
                  <Ionicons name={action.icon} size={20} color={textColors.secondary} />
                ) : null}
                <Text style={[styles.text, (busy || action.disabled) && styles.secondary]}>
                  {action.label}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={textColors.secondary} />
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            accessibilityLabel={closeLabel}
            onPress={onClose}
            style={styles.action}
          >
            <Text style={styles.text}>{closeLabel}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.24)' },
  sheet: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    maxHeight: '80%',
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    padding: spacing.md,
  },
  title: {
    ...typography.heading2,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    color: textColors.primary,
    paddingBottom: spacing.md,
  },
  action: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    paddingVertical: spacing.sm,
  },
  text: { ...typography.body, fontFamily: fontFamilies.sans, color: textColors.primary, flex: 1 },
  secondary: { color: textColors.secondary },
  message: {
    ...typography.description,
    fontFamily: fontFamilies.sans,
    color: textColors.secondary,
    paddingBottom: spacing.sm,
  },
});
