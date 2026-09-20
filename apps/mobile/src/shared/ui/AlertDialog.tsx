/**
 * 单个动作结果的提示弹窗。
 *
 * 用于把“保存能力绑定失败”这类必须被看见的结果放在触发动作附近，而不是页面顶部的横幅。
 *
 * Responsibilities:
 * - 以模态呈现标题、正文和最多两个动作。
 * - 保持遮罩关闭、返回键关闭和可访问性语义。
 *
 * Notes:
 * - 只负责呈现，不承载业务状态；调用方决定按钮文案与后续动作。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

/** 提示弹窗的单个动作。 */
export type AlertDialogAction = {
  label: string;
  onPress: () => void;
  testID?: string;
};

/** 渲染一个标题、正文与动作按钮组成的提示弹窗。 */
export function AlertDialog({
  actions,
  message,
  onClose,
  title,
  tone = 'error',
  visible,
}: {
  actions: AlertDialogAction[];
  message: ReactNode;
  onClose: () => void;
  title: string;
  tone?: 'error' | 'info' | 'success';
  visible: boolean;
}) {
  const { t } = useAppLanguage();
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.dialog}>
          <View style={styles.header}>
            <Ionicons
              color={tone === 'error' ? colors.danger : colors.ink}
              name={
                tone === 'error'
                  ? 'alert-circle-outline'
                  : tone === 'success'
                    ? 'checkmark-circle-outline'
                    : 'information-circle-outline'
              }
              size={24}
            />
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
          </View>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            {actions.map((action) => (
              <Pressable
                accessibilityLabel={action.label}
                accessibilityRole="button"
                key={action.label}
                onPress={action.onPress}
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
                testID={action.testID}
              >
                <Text style={styles.buttonText}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.32)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dialog: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.md,
    maxWidth: 420,
    padding: spacing.lg,
    width: '100%',
  },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  title: {
    ...typography.heading2,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  message: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-end' },
  button: {
    alignItems: 'center',
    backgroundColor: colors.black,
    borderRadius: radii.default,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  buttonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  pressed: { opacity: 0.78 },
});
