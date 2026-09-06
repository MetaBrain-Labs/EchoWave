/**
 * 新手引导中心。
 *
 * 展示六项独立引导的用途、步骤数和设备端状态，并允许单独开始或重播。
 *
 * Responsibilities:
 * - 将注册表元数据映射为可访问的引导卡片。
 * - 在依赖模板的引导不可用时给出明确提示。
 *
 * Notes:
 * - 开始引导只执行导航与临时展示，不写入业务数据。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useStarterTour } from '@/shared/onboarding/StarterTourContext';
import { GUIDE_IDS, GUIDE_REGISTRY, type GuideStatus } from '@/shared/onboarding/guideRegistry';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';

const statusCopy: Record<GuideStatus, string> = {
  not_started: '未开始',
  completed: '已完成',
  skipped: '已跳过',
};

/** 渲染六项产品引导目录。 */
export function GuideCenterScreen({ onBack }: { onBack: () => void }) {
  const { startGuide, statuses, templates } = useStarterTour();
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <TopLevelPageHeader
        onBack={onBack}
        subtitle="按主题学习，随时可以跳过或重播。"
        title="新手引导"
      />
      <ScrollView contentContainerStyle={styles.content}>
        {GUIDE_IDS.map((id) => {
          const guide = GUIDE_REGISTRY[id];
          const status = statuses[id];
          const needsSalesTemplate = id === 'basic' || id === 'analysis';
          const disabled = needsSalesTemplate && !templates.sales_call_review;
          return (
            <View key={id} style={styles.card}>
              <View style={styles.headingRow}>
                <View style={styles.icon}>
                  <Ionicons color={colors.ink} name="navigate-outline" size={20} />
                </View>
                <View style={styles.copy}>
                  <Text style={styles.title}>{guide.title}</Text>
                  <Text style={styles.meta}>
                    {guide.steps.length} 步 · {statusCopy[status]}
                  </Text>
                </View>
                <Text style={[styles.status, status === 'completed' && styles.completed]}>
                  {statusCopy[status]}
                </Text>
              </View>
              <Text style={styles.description}>{guide.description}</Text>
              {disabled ? (
                <Text style={styles.warning}>销售通话复盘模板不可用，请先恢复该模板分组。</Text>
              ) : null}
              <Pressable
                accessibilityLabel={`${status === 'not_started' ? '开始' : '重播'}${guide.title}`}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => startGuide(id)}
                style={({ pressed }) => [
                  styles.action,
                  disabled && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.actionText}>
                  {status === 'not_started' ? '开始引导' : '重新播放'}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  content: { gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  copy: { flex: 1 },
  title: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  meta: { ...typography.label, color: textColors.tertiary },
  status: {
    ...typography.label,
    backgroundColor: colors.background,
    borderRadius: radii.default,
    color: textColors.secondary,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  completed: { backgroundColor: colors.successSurface, color: colors.success },
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  warning: { ...typography.label, color: textColors.secondary },
  action: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  actionText: { ...typography.description, color: colors.white, fontWeight: 'bold' },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.65 },
});
