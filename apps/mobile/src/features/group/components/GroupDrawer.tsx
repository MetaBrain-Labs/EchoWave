/**
 * 分组目录侧栏。
 *
 * 按产品参考稿呈现品牌、分组创建入口和可滚动分组列表，并把分组设置作为独立操作保留。
 *
 * Responsibilities:
 * - 展示当前租户的分组目录与当前选中状态。
 * - 收集新分组名称并转发创建请求。
 * - 区分分组切换与分组设置导航。
 *
 * Notes:
 * - 服务端数据、当前分组和 pending 状态由 GroupScreen 持有。
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
  onOpenSettings,
  onSelect,
  selectedGroupId,
  visible,
}: {
  createError: string;
  creating: boolean;
  groups: GroupSummary[];
  onClose: () => void;
  onCreate: (name: string) => Promise<boolean>;
  onOpenSettings: (group: GroupSummary) => void;
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
    // 动画回调在测试环境和中断场景不稳定，因此用同周期计时器统一结束生命周期。
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
            <Text accessibilityRole="header" style={styles.brandTitle}>
              EchoWave
            </Text>

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
                      styles.createSubmitButton,
                      (!name.trim() || creating) && styles.disabled,
                      pressed && styles.primaryPressed,
                    ]}
                  >
                    {creating ? (
                      <ActivityIndicator color={colors.white} size="small" />
                    ) : (
                      <Text style={styles.createSubmitText}>创建</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityLabel="添加分组"
                accessibilityRole="button"
                onPress={() => setAdding(true)}
                style={({ pressed }) => [styles.addButton, pressed && styles.primaryPressed]}
              >
                <Ionicons color={colors.white} name="add" size={32} />
                <Text style={styles.addButtonText}>创建新分组</Text>
              </Pressable>
            )}

            <Text style={styles.sectionTitle}>分组列表</Text>
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
                      accessibilityState={{ selected }}
                      style={[styles.groupCard, selected && styles.selectedCard]}
                    >
                      <Pressable
                        accessibilityLabel={`切换到分组：${group.name}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => {
                          onSelect(group);
                          closeDrawer();
                        }}
                        style={({ pressed }) => [styles.groupMain, pressed && styles.pressed]}
                      >
                        <Text numberOfLines={1} style={styles.groupName}>
                          {group.name}
                        </Text>
                        <Text style={styles.groupMetrics}>
                          {group.metrics.analysisCount} 份分析{selected ? ' · 当前分组' : ''}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`打开分组设置：${group.name}`}
                        accessibilityRole="button"
                        hitSlop={6}
                        onPress={() => closeDrawer(() => onOpenSettings(group))}
                        style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
                      >
                        <Ionicons color={textColors.secondary} name="options-outline" size={24} />
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

const styles = StyleSheet.create({
  drawerOverlay: { backgroundColor: 'rgba(16, 24, 40, 0.24)', flex: 1, flexDirection: 'row' },
  drawer: { backgroundColor: colors.card, maxWidth: 360, width: '78%' },
  drawerSafeArea: { flex: 1, paddingHorizontal: spacing.lg },
  drawerBackdrop: { flex: 1 },
  brandTitle: {
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontSize: 32,
    fontWeight: 'bold',
    lineHeight: 44,
    marginBottom: spacing.xl,
    marginTop: spacing.lg,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    minHeight: 58,
    paddingHorizontal: spacing.md,
  },
  addButtonText: {
    ...typography.heading2,
    color: colors.white,
    fontFamily: fontFamilies.sans,
  },
  createBox: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.card,
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
  createSubmitButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 76,
    paddingHorizontal: spacing.md,
  },
  createSubmitText: {
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
  sectionTitle: {
    ...typography.heading3,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginTop: spacing.xl,
  },
  groupList: { gap: spacing.sm, paddingBottom: spacing.xxl, paddingTop: spacing.md },
  groupCard: {
    alignItems: 'stretch',
    backgroundColor: colors.card,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'transparent',
    borderLeftWidth: 3,
    borderRadius: radii.default,
    flexDirection: 'row',
    minHeight: 84,
    overflow: 'hidden',
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
  },
  selectedCard: { backgroundColor: colors.background, borderLeftColor: colors.ink },
  groupMain: { flex: 1, gap: spacing.xs, justifyContent: 'center', padding: spacing.md },
  groupName: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  groupMetrics: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  settingsButton: { alignItems: 'center', justifyContent: 'center', width: 48 },
  emptyState: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
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
  errorText: { ...typography.description, color: '#b42318', fontFamily: fontFamilies.sans },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: colors.background },
  primaryPressed: { opacity: 0.78 },
});
