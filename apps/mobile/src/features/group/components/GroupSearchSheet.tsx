/**
 * 分组页面跨标签搜索抽屉。
 *
 * 从底部收集一条共享查询，并仅在用户提交后应用到三个分组子资源列表。
 *
 * Responsibilities:
 * - 管理尚未提交的搜索草稿。
 * - 支持键盘提交、显式搜索、清除和取消。
 *
 * Notes:
 * - 实际筛选由 GroupScreen 的纯查询模型完成。
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

import { colors, fontFamilies, radii, spacing, textColors, typography } from '@/shared/theme/tokens';

/** 渲染从底部出现的当前分组搜索表单。 */
export function GroupSearchSheet({
  appliedQuery,
  onApply,
  onClose,
  visible,
}: {
  appliedQuery: string;
  onApply: (query: string) => void;
  onClose: () => void;
  visible: boolean;
}) {
  const [draft, setDraft] = useState(appliedQuery);

  const submit = () => {
    Keyboard.dismiss();
    onApply(draft.trim());
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <Pressable accessibilityLabel="关闭搜索抽屉遮罩" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text accessibilityRole="header" style={styles.title}>搜索当前分组</Text>
              <Text style={styles.subtitle}>查询会同时作用于三个标签页</Text>
            </View>
            <Pressable accessibilityLabel="关闭搜索抽屉" accessibilityRole="button" hitSlop={8} onPress={onClose} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
              <Ionicons color={colors.ink} name="close" size={26} />
            </Pressable>
          </View>
          <View style={styles.searchRow}>
            <View style={styles.inputBox}>
              <Ionicons color={textColors.tertiary} name="search" size={20} />
              <TextInput
                accessibilityLabel="输入搜索关键词"
                autoFocus
                onChangeText={setDraft}
                onSubmitEditing={submit}
                placeholder="搜索音频、知识库或数据源"
                placeholderTextColor={textColors.tertiary}
                returnKeyType="search"
                style={styles.input}
                value={draft}
              />
              {draft ? (
                <Pressable accessibilityLabel="清除搜索" accessibilityRole="button" hitSlop={8} onPress={() => setDraft('')}>
                  <Ionicons color={textColors.secondary} name="close-circle" size={20} />
                </Pressable>
              ) : null}
            </View>
            <Pressable accessibilityLabel="执行搜索" accessibilityRole="button" onPress={submit} style={({ pressed }) => [styles.searchButton, pressed && styles.primaryPressed]}>
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
  sheet: { alignSelf: 'center', backgroundColor: colors.card, borderTopLeftRadius: spacing.lg, borderTopRightRadius: spacing.lg, maxWidth: 480, paddingBottom: spacing.xl, width: '100%' },
  header: { alignItems: 'center', borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  title: { ...typography.heading1, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  subtitle: { ...typography.label, color: textColors.tertiary, fontFamily: fontFamilies.sans, marginTop: spacing.xs },
  iconButton: { alignItems: 'center', borderRadius: radii.round, height: 44, justifyContent: 'center', width: 44 },
  pressed: { backgroundColor: colors.background },
  searchRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  inputBox: { alignItems: 'center', borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, flex: 1, flexDirection: 'row', gap: spacing.sm, height: 48, paddingHorizontal: spacing.base },
  input: { ...typography.body, color: textColors.primary, flex: 1, fontFamily: fontFamilies.sans, height: 46, includeFontPadding: false, paddingVertical: 0, textAlignVertical: 'center' },
  searchButton: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radii.default, height: 48, justifyContent: 'center', width: 48 },
  primaryPressed: { opacity: 0.78 },
});
