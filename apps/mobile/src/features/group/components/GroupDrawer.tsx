/**
 * 分组目录侧栏与归档确认框。
 *
 * 提供跨平台分组切换、侧栏内联创建和无破坏性的归档确认交互。
 *
 * Responsibilities:
 * - 展示当前租户的分组卡片和选中状态。
 * - 收集新分组名称并转发创建请求。
 * - 在真正归档前明确提示数据保留边界。
 *
 * Notes:
 * - 服务器数据和 pending 状态由 GroupScreen 持有。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { GroupSummary } from '@echowave/contracts';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

/** 渲染从左侧进入的分组目录。 */
export function GroupDrawer({
  createError,
  creating,
  groups,
  onClose,
  onCreate,
  onRequestArchive,
  onSelect,
  selectedGroupId,
  visible,
}: {
  createError: string;
  creating: boolean;
  groups: GroupSummary[];
  onClose: () => void;
  onCreate: (name: string) => Promise<boolean>;
  onRequestArchive: (group: GroupSummary) => void;
  onSelect: (group: GroupSummary) => void;
  selectedGroupId?: string;
  visible: boolean;
}) {
  const [translateX] = useState(() => new Animated.Value(-380));
  const closing = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!visible) return;
    closing.current = false;
    Animated.timing(translateX, {
      duration: 220,
      toValue: 0,
      useNativeDriver: true,
    }).start();
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [translateX, visible]);

  const closeDrawer = (afterClose?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(translateX, {
      duration: 200,
      toValue: -380,
      useNativeDriver: true,
    }).start();
    // 原生动画回调在测试环境及中断场景下不稳定，因此由同周期计时器统一结束生命周期。
    closeTimer.current = setTimeout(() => {
      onClose();
      afterClose?.();
    }, 200);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    if (await onCreate(trimmed)) closeDrawer();
  };

  return (
    <Modal animationType="none" onRequestClose={() => closeDrawer()} transparent visible={visible}>
      <View accessibilityViewIsModal style={styles.drawerOverlay}>
        <Animated.View style={[styles.drawer, { transform: [{ translateX }] }]}>
          <SafeAreaView edges={['top', 'bottom']} style={styles.drawerSafeArea}>
            <View style={styles.drawerHeader}>
              <Text accessibilityRole="header" style={styles.drawerTitle}>
                分组
              </Text>
              <Pressable
                accessibilityLabel="关闭分组侧栏"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => closeDrawer()}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <Ionicons color={colors.ink} name="close" size={26} />
              </Pressable>
            </View>

            {adding ? (
              <View style={styles.createBox}>
                <TextInput
                  accessibilityLabel="分组名称"
                  autoFocus
                  editable={!creating}
                  maxLength={120}
                  onChangeText={setName}
                  onSubmitEditing={() => {
                    void submit();
                  }}
                  placeholder="输入分组名称"
                  placeholderTextColor={textColors.tertiary}
                  returnKeyType="done"
                  style={styles.input}
                  value={name}
                />
                {createError ? (
                  <Text accessibilityRole="alert" style={styles.errorText}>
                    {createError}
                  </Text>
                ) : null}
                <View style={styles.createActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={creating}
                    onPress={() => {
                      setAdding(false);
                      setName('');
                    }}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryButtonText}>取消</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!name.trim() || creating}
                    onPress={() => {
                      void submit();
                    }}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      (!name.trim() || creating) && styles.disabled,
                      pressed && styles.primaryPressed,
                    ]}
                  >
                    {creating ? (
                      <ActivityIndicator color={colors.white} size="small" />
                    ) : (
                      <Text style={styles.primaryButtonText}>创建</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityLabel="添加分组"
                accessibilityRole="button"
                onPress={() => setAdding(true)}
                style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
              >
                <Ionicons color={colors.ink} name="add" size={22} />
                <Text style={styles.addButtonText}>添加分组</Text>
              </Pressable>
            )}

            <ScrollView
              contentContainerStyle={styles.groupList}
              showsVerticalScrollIndicator={false}
            >
              {groups.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>还没有分组</Text>
                  <Text style={styles.emptyDescription}>使用上方按钮创建第一个分组。</Text>
                </View>
              ) : (
                groups.map((group) => {
                  const selected = group.id === selectedGroupId;
                  return (
                    <View
                      key={group.id}
                      style={[styles.groupCard, selected && styles.selectedCard]}
                    >
                      <Pressable
                        accessibilityLabel={`切换到分组：${group.name}`}
                        accessibilityRole="button"
                        onPress={() => {
                          onSelect(group);
                          closeDrawer();
                        }}
                        style={({ pressed }) => [styles.groupMain, pressed && styles.pressed]}
                      >
                        <View style={styles.groupTitleRow}>
                          <Text numberOfLines={1} style={styles.groupName}>
                            {group.name}
                          </Text>
                          {selected ? (
                            <Ionicons color={colors.success} name="checkmark-circle" size={20} />
                          ) : null}
                        </View>
                        <Text style={styles.groupMetrics}>
                          {group.metrics.audioCount} 音频 · {group.metrics.analysisCount} 分析 ·{' '}
                          {group.metrics.knowledgeCount} 知识库 · {group.metrics.sourceCount} 数据源
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`归档分组：${group.name}`}
                        accessibilityRole="button"
                        hitSlop={6}
                        onPress={() => closeDrawer(() => onRequestArchive(group))}
                        style={({ pressed }) => [styles.archiveButton, pressed && styles.pressed]}
                      >
                        <Ionicons color={textColors.secondary} name="archive-outline" size={20} />
                      </Pressable>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
        <Pressable
          accessibilityLabel="关闭分组侧栏遮罩"
          accessibilityRole="button"
          onPress={() => closeDrawer()}
          style={styles.drawerBackdrop}
        />
      </View>
    </Modal>
  );
}

/** 渲染分组软归档的二次确认对话框。 */
export function GroupArchiveDialog({
  error,
  group,
  onCancel,
  onConfirm,
  pending,
}: {
  error: string;
  group?: GroupSummary;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={Boolean(group)}>
      <View accessibilityViewIsModal style={styles.dialogOverlay}>
        <View style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            归档分组
          </Text>
          <Text style={styles.dialogDescription}>
            确认归档“{group?.name}”吗？分组会从列表隐藏，但关联的知识库、数据源和音频不会被删除。
          </Text>
          {error ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onCancel}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryButtonText}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="确认归档分组"
              accessibilityRole="button"
              disabled={pending}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.dangerButton,
                pending && styles.disabled,
                pressed && styles.dangerPressed,
              ]}
            >
              {pending ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>确认归档</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  drawerOverlay: { backgroundColor: 'rgba(16, 24, 40, 0.28)', flex: 1, flexDirection: 'row' },
  drawer: { backgroundColor: colors.card, maxWidth: 360, width: '86%' },
  drawerSafeArea: { flex: 1 },
  drawerBackdrop: { flex: 1 },
  drawerHeader: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  drawerTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: radii.round,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: { backgroundColor: colors.background },
  addButton: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  addButtonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  createBox: {
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  input: {
    ...typography.body,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    height: 44,
    includeFontPadding: false,
    paddingHorizontal: spacing.base,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  createActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 76,
    paddingHorizontal: spacing.md,
  },
  primaryPressed: { opacity: 0.78 },
  primaryButtonText: {
    ...typography.description,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 68,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  disabled: { opacity: 0.45 },
  errorText: { ...typography.description, color: '#b42318', fontFamily: fontFamilies.sans },
  groupList: { gap: spacing.sm, padding: spacing.md },
  groupCard: {
    alignItems: 'stretch',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  selectedCard: { borderColor: colors.success, borderWidth: 2 },
  groupMain: { flex: 1, gap: spacing.sm, minHeight: 84, padding: spacing.md },
  groupTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  groupName: {
    ...typography.heading2,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  groupMetrics: { ...typography.label, color: textColors.tertiary, fontFamily: fontFamilies.sans },
  archiveButton: {
    alignItems: 'center',
    borderLeftColor: colors.divider,
    borderLeftWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    width: 48,
  },
  emptyState: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  emptyDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  dialogOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.38)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  dialog: {
    backgroundColor: colors.card,
    borderRadius: spacing.md,
    gap: spacing.md,
    maxWidth: 420,
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
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#b42318',
    borderRadius: radii.default,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 96,
    paddingHorizontal: spacing.md,
  },
  dangerPressed: { backgroundColor: '#8f1d13' },
});
