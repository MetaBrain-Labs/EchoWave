/**
 * 通用列表搜索抽屉。
 *
 * 以底部抽屉收集搜索草稿，并在用户明确提交后把规范化查询交给业务页面。
 *
 * Responsibilities:
 * - 支持键盘提交、显式搜索、清除与取消。
 * - 为不同列表提供可配置的标题、说明和占位文案。
 *
 * Notes:
 * - 组件不持有业务列表，也不决定具体匹配字段。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

/** 渲染可复用的底部搜索表单。 */
export function SearchSheet({
  appliedQuery,
  inputLabel,
  onApply,
  onClose,
  placeholder,
  subtitle,
  title,
  visible,
}: {
  appliedQuery: string;
  inputLabel: string;
  onApply: (query: string) => void;
  onClose: () => void;
  placeholder: string;
  subtitle?: string;
  title: string;
  visible: boolean;
}) {
  const { t } = useAppLanguage();
  const [draft, setDraft] = useState(appliedQuery);

  const submit = () => {
    Keyboard.dismiss();
    onApply(draft.trim());
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'web' ? undefined : 'padding'}
        style={styles.overlay}
      >
        <Pressable
          accessibilityLabel={t('common.closeSearchDrawer')}
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable
              accessibilityLabel={t('common.closeSearchDrawer')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Ionicons color={colors.ink} name="close" size={26} />
            </Pressable>
          </View>
          <View style={styles.searchRow}>
            <View style={styles.inputBox}>
              <Ionicons color={textColors.tertiary} name="search" size={20} />
              <TextInput
                accessibilityLabel={inputLabel}
                autoFocus
                onChangeText={setDraft}
                onSubmitEditing={submit}
                placeholder={placeholder}
                placeholderTextColor={textColors.tertiary}
                returnKeyType="search"
                style={styles.input}
                value={draft}
              />
              {draft ? (
                <Pressable
                  accessibilityLabel={t('common.clearSearch')}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setDraft('')}
                >
                  <Ionicons color={textColors.secondary} name="close-circle" size={20} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              accessibilityLabel={t('common.performSearch')}
              accessibilityRole="button"
              onPress={submit}
              style={({ pressed }) => [styles.searchButton, pressed && styles.primaryPressed]}
            >
              <Ionicons color={colors.white} name="search" size={20} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: 'rgba(16, 24, 40, 0.28)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderTopLeftRadius: spacing.lg,
    borderTopRightRadius: spacing.lg,
    maxWidth: 480,
    paddingBottom: spacing.xl,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  heading: { flex: 1, paddingRight: spacing.sm },
  title: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  subtitle: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: radii.round,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: { backgroundColor: colors.background },
  searchRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  inputBox: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.base,
  },
  input: {
    ...typography.body,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sans,
    height: 46,
    includeFontPadding: false,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  searchButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  primaryPressed: { opacity: 0.78 },
});
