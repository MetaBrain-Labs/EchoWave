/**
 * 知识库分组关联弹层。
 *
 * 提供批量选择未关联分组的底部抽屉，以及切换到关联分组前的二次确认。
 *
 * Responsibilities:
 * - 区分已关联、待选择和可选择分组。
 * - 在请求失败时保留用户选择并提供重试入口。
 * - 阻止切换分组前的误操作。
 *
 * Notes:
 * - 关联事实和 pending 状态由知识库详情页持有。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { GroupSummary } from '@echowave/contracts';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 渲染知识库可关联分组的多选底部抽屉。 */
export function KnowledgeGroupPicker({
  allGroups,
  error,
  linkedGroupIds,
  loading,
  onClose,
  onConfirm,
  onRetry,
  onToggle,
  pending,
  selectedGroupIds,
  visible,
}: {
  allGroups: GroupSummary[];
  error: string;
  linkedGroupIds: Set<string>;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  onToggle: (id: string) => void;
  pending: boolean;
  selectedGroupIds: Set<string>;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View accessibilityViewIsModal style={styles.sheetOverlay}>
        <Pressable
          accessibilityLabel="关闭关联分组选择"
          accessibilityRole="button"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View>
              <Text accessibilityRole="header" style={styles.sheetTitle}>
                关联新分组
              </Text>
              <Text style={styles.sheetDescription}>
                可一次选择多个分组，已关联分组不可重复选择。
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭分组选择抽屉"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={styles.iconButton}
            >
              <Ionicons color={colors.ink} name="close" size={26} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.groupOptions}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <ActivityIndicator accessibilityLabel="正在加载可关联分组" color={colors.ink} />
            ) : null}
            {error ? (
              <Pressable accessibilityRole="button" onPress={onRetry} style={styles.feedback}>
                <Text accessibilityRole="alert" style={styles.feedbackText}>
                  {error}
                </Text>
                <Text style={styles.retryText}>点击重试</Text>
              </Pressable>
            ) : null}
            {!loading && !error && allGroups.length === 0 ? (
              <Text style={styles.emptyText}>暂无可用分组</Text>
            ) : null}
            {allGroups.map((group) => {
              const linked = linkedGroupIds.has(group.id);
              const selected = selectedGroupIds.has(group.id);
              return (
                <Pressable
                  key={group.id}
                  accessibilityLabel={`${linked ? '已关联分组' : selected ? '取消选择分组' : '选择分组'}：${group.name}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: linked || selected, disabled: linked || pending }}
                  disabled={linked || pending}
                  onPress={() => onToggle(group.id)}
                  style={({ pressed }) => [
                    styles.groupOption,
                    linked && styles.linkedOption,
                    selected && styles.selectedOption,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.groupOptionMain}>
                    <Text
                      numberOfLines={1}
                      style={[styles.groupOptionTitle, linked && styles.disabledText]}
                    >
                      {group.name}
                    </Text>
                    <Text style={[styles.groupOptionMeta, linked && styles.disabledText]}>
                      {group.metrics.audioCount} 音频 · {group.metrics.knowledgeCount} 知识库
                    </Text>
                  </View>
                  <Ionicons
                    color={linked ? textColors.tertiary : selected ? colors.ink : colors.secondary}
                    name={linked ? 'checkmark-circle' : selected ? 'checkbox' : 'square-outline'}
                    size={24}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.sheetActions}>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onClose}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="确认关联所选分组"
              accessibilityRole="button"
              disabled={selectedGroupIds.size === 0 || pending}
              onPress={onConfirm}
              style={[
                styles.primaryButton,
                (selectedGroupIds.size === 0 || pending) && styles.disabled,
              ]}
            >
              {pending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>确认关联</Text>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** 在离开知识库详情前确认目标分组。 */
export function KnowledgeGroupSwitchDialog({
  group,
  onCancel,
  onConfirm,
}: {
  group?: GroupSummary;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={Boolean(group)}>
      <View accessibilityViewIsModal style={styles.dialogOverlay}>
        <View style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            切换分组
          </Text>
          <Text style={styles.dialogDescription}>是否切换至“{group?.name}”分组并返回主页面？</Text>
          <View style={styles.dialogActions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.dialogButton}>
              <Text style={styles.secondaryButtonText}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="确认切换分组"
              accessibilityRole="button"
              onPress={onConfirm}
              style={[styles.dialogButton, styles.dialogPrimary]}
            >
              <Text style={styles.primaryButtonText}>确认切换</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(16, 24, 40, 0.28)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    maxHeight: '78%',
    minHeight: 360,
  },
  sheetHeader: {
    alignItems: 'flex-start',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  sheetTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  sheetDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  iconButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  groupOptions: { gap: spacing.sm, padding: spacing.md },
  groupOption: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 72,
    padding: spacing.base,
  },
  linkedOption: { backgroundColor: colors.background, opacity: 0.55 },
  selectedOption: { borderColor: colors.ink, borderWidth: 2 },
  groupOptionMain: { flex: 1, gap: spacing.xs },
  groupOptionTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  groupOptionMeta: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  disabledText: { color: textColors.tertiary },
  feedback: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  feedbackText: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  retryText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  emptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    padding: spacing.lg,
    textAlign: 'center',
  },
  sheetActions: {
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryButtonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: colors.background },
  dialogOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.28)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  dialog: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.md,
    maxWidth: 400,
    padding: spacing.lg,
    width: '100%',
  },
  dialogTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  dialogDescription: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  dialogActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  dialogButton: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.md,
  },
  dialogPrimary: { backgroundColor: colors.ink, borderColor: colors.ink },
});
