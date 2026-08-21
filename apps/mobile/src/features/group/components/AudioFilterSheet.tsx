/**
 * 分组音频排序与状态筛选抽屉。
 *
 * 以草稿方式编辑创建时间排序和多选处理状态，只有确认后才提交给页面。
 *
 * Responsibilities:
 * - 呈现创建时间单选项和状态复选项。
 * - 支持取消、重置和确认语义。
 *
 * Notes:
 * - 空状态集合表示不限制处理状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamilies, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import {
  audioStatusLabels,
  type AudioSortOrder,
  type AudioStatusKind,
} from '../model';

const statusOptions = Object.entries(audioStatusLabels) as [AudioStatusKind, string][];

/** 渲染音频排序和多状态筛选表单。 */
export function AudioFilterSheet({
  onApply,
  onClose,
  selectedStatuses,
  sortOrder,
  visible,
}: {
  onApply: (sortOrder: AudioSortOrder, statuses: Set<AudioStatusKind>) => void;
  onClose: () => void;
  selectedStatuses: ReadonlySet<AudioStatusKind>;
  sortOrder: AudioSortOrder;
  visible: boolean;
}) {
  const [draftSort, setDraftSort] = useState<AudioSortOrder>(sortOrder);
  const [draftStatuses, setDraftStatuses] = useState<Set<AudioStatusKind>>(() => new Set(selectedStatuses));

  const toggleStatus = (status: AudioStatusKind) => {
    setDraftStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="关闭排序筛选抽屉遮罩" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text accessibilityRole="header" style={styles.title}>排序筛选</Text>
              <Text style={styles.subtitle}>未选择状态时展示全部状态</Text>
            </View>
            <Pressable accessibilityLabel="关闭排序筛选抽屉" accessibilityRole="button" hitSlop={8} onPress={onClose} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
              <Ionicons color={colors.ink} name="close" size={26} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>创建时间</Text>
            {([
              ['newest', '最新优先'],
              ['oldest', '最早优先'],
            ] as const).map(([value, label]) => {
              const selected = draftSort === value;
              return (
                <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setDraftSort(value)} style={({ pressed }) => [styles.optionRow, pressed && styles.pressed]}>
                  <Ionicons color={selected ? colors.ink : textColors.tertiary} name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} />
                  <Text style={styles.optionText}>{label}</Text>
                </Pressable>
              );
            })}

            <View style={styles.statusHeader}>
              <Text style={styles.sectionTitle}>处理状态（多选）</Text>
              {draftStatuses.size ? <Text style={styles.selectionCount}>已选 {draftStatuses.size} 项</Text> : null}
            </View>
            {statusOptions.map(([value, label]) => {
              const checked = draftStatuses.has(value);
              return (
                <Pressable key={value} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => toggleStatus(value)} style={({ pressed }) => [styles.optionRow, pressed && styles.pressed]}>
                  <Ionicons color={checked ? colors.ink : textColors.tertiary} name={checked ? 'checkbox' : 'square-outline'} size={22} />
                  <Text style={styles.optionText}>{label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.footer}>
            <Pressable accessibilityRole="button" onPress={() => { setDraftSort('newest'); setDraftStatuses(new Set()); }} style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}>
              <Text style={styles.resetText}>重置</Text>
            </Pressable>
            <Pressable accessibilityLabel="确认排序筛选" accessibilityRole="button" onPress={() => onApply(draftSort, new Set(draftStatuses))} style={({ pressed }) => [styles.confirmButton, pressed && styles.primaryPressed]}>
              <Text style={styles.confirmText}>确认</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: 'rgba(16, 24, 40, 0.28)', flex: 1, justifyContent: 'flex-end' },
  sheet: { alignSelf: 'center', backgroundColor: colors.card, borderTopLeftRadius: spacing.lg, borderTopRightRadius: spacing.lg, maxHeight: '82%', maxWidth: 480, width: '100%' },
  header: { alignItems: 'center', borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  title: { ...typography.heading1, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  subtitle: { ...typography.label, color: textColors.tertiary, fontFamily: fontFamilies.sans, marginTop: spacing.xs },
  iconButton: { alignItems: 'center', borderRadius: radii.round, height: 44, justifyContent: 'center', width: 44 },
  pressed: { backgroundColor: colors.background },
  content: { gap: spacing.xs, padding: spacing.md },
  sectionTitle: { ...typography.heading3, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold', marginBottom: spacing.xs, marginTop: spacing.sm },
  optionRow: { alignItems: 'center', borderRadius: radii.default, flexDirection: 'row', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.sm },
  optionText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  statusHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  selectionCount: { ...typography.label, color: textColors.secondary, fontFamily: fontFamilies.sans },
  footer: { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end', padding: spacing.md, paddingBottom: spacing.xl },
  resetButton: { alignItems: 'center', borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.lg },
  resetText: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  confirmButton: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radii.default, justifyContent: 'center', minHeight: 44, minWidth: 96, paddingHorizontal: spacing.lg },
  confirmText: { ...typography.description, color: colors.white, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  primaryPressed: { opacity: 0.78 },
});
