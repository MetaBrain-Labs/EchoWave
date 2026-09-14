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
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.actions}>
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
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                {action.icon ? (
                  <Ionicons name={action.icon} size={22} color={textColors.secondary} />
                ) : null}
                <Text style={[styles.text, (busy || action.disabled) && styles.secondary]}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            accessibilityLabel={closeLabel}
            onPress={onClose}
            style={styles.cancel}
          >
            <Text style={styles.cancelText}>{closeLabel}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16, 24, 40, 0.28)' },
  sheet: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    maxHeight: '80%',
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  actions: { flexGrow: 0 },
  pressed: { backgroundColor: colors.background },
  title: {
    ...typography.heading2,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    color: textColors.primary,
    paddingBottom: spacing.xs,
  },
  action: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  text: { ...typography.body, fontFamily: fontFamilies.sans, color: textColors.primary, flex: 1 },
  cancel: { alignItems: 'center', minHeight: 48, paddingTop: spacing.md },
  cancelText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  secondary: { color: textColors.secondary },
  message: {
    ...typography.description,
    fontFamily: fontFamilies.sans,
    color: textColors.secondary,
    paddingBottom: spacing.sm,
  },
});
