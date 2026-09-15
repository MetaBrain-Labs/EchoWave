/**
 * 跨平台操作菜单。
 *
 * 使用 React Native Modal 呈现一组可访问的动作，统一处理遮罩、取消和危险操作样式。
 *
 * Responsibilities:
 * - 为移动端和 Web 提供与数据源操作抽屉一致的底部操作菜单。
 * - 将动作执行交给调用方，不承载领域状态或网络请求。
 *
 * Notes:
 * - 新式 items 动作会先关闭菜单；兼容旧式 actions 时保留调用方控制关闭时机。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

/** 描述操作菜单中的稳定身份、图标、禁用状态和执行动作。 */
export type ActionSheetItem = {
  destructive?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  id?: string;
  label: string;
  onPress: () => void;
};

/** 渲染带遮罩的动作列表。 */
export function ActionSheet({
  actions,
  busy = false,
  closeLabel,
  items,
  message,
  onClose,
  title,
  visible,
}: {
  actions?: ActionSheetItem[];
  busy?: boolean;
  closeLabel?: string;
  items?: ActionSheetItem[];
  message?: string;
  onClose: () => void;
  title?: string;
  visible: boolean;
}) {
  const { t } = useAppLanguage();
  const resolvedItems = items ?? actions ?? [];
  const preserveLegacyCloseSemantics = items === undefined && actions !== undefined;
  const [mounted, setMounted] = useState(visible);
  const [backdropOpacity] = useState(() => new Animated.Value(0));
  const [sheetProgress] = useState(() => new Animated.Value(1));
  const sheetTranslateY = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 480],
  });

  useEffect(() => {
    if (visible) {
      backdropOpacity.stopAnimation();
      sheetProgress.stopAnimation();
      backdropOpacity.setValue(0);
      sheetProgress.setValue(1);
      const frame = requestAnimationFrame(() => {
        Animated.parallel([
          Animated.timing(backdropOpacity, {
            duration: 180,
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(sheetProgress, {
            duration: 220,
            toValue: 0,
            useNativeDriver: true,
          }),
        ]).start();
      });
      return () => cancelAnimationFrame(frame);
    }

    if (!mounted) return undefined;
    backdropOpacity.stopAnimation();
    sheetProgress.stopAnimation();
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        duration: 150,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(sheetProgress, {
        duration: 180,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return undefined;
  }, [backdropOpacity, mounted, sheetProgress, visible]);

  if (!visible && !mounted) return null;

  return (
    <Modal
      animationType="none"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
      transparent
      visible={visible || mounted}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}
        >
          <Pressable
            accessibilityLabel={t('common.close')}
            accessibilityRole="button"
            disabled={busy}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}
        >
          {title ? (
            <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          ) : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <ScrollView
            contentContainerStyle={styles.items}
            keyboardShouldPersistTaps="handled"
            style={styles.itemScroll}
          >
            {resolvedItems.map((item) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: item.disabled || busy }}
                disabled={item.disabled || busy}
                key={item.id ?? item.label}
                onPress={() => {
                  if (!preserveLegacyCloseSemantics) onClose();
                  item.onPress();
                }}
                style={({ pressed }) => [
                  styles.item,
                  item.destructive && styles.destructiveItem,
                  (item.disabled || busy) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {item.icon ? (
                  <Ionicons
                    color={item.destructive ? colors.ink : colors.secondary}
                    name={item.icon}
                    size={22}
                  />
                ) : null}
                <Text style={[styles.itemText, item.destructive && styles.destructiveText]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onClose}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          >
            <Text style={styles.cancelText}>{closeLabel ?? t('common.cancel')}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(16, 24, 40, 0.28)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    maxHeight: '85%',
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
  message: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    paddingHorizontal: spacing.sm,
  },
  items: {},
  itemScroll: { flexGrow: 0 },
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 52,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  destructiveItem: {},
  destructiveText: { fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  cancel: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingTop: spacing.md,
  },
  cancelText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: colors.background },
});
