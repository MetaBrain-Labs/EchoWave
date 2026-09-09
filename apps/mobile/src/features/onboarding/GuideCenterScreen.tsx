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
import {
  GUIDE_IDS,
  localizeGuideRegistry,
  type GuideStatus,
} from '@/shared/onboarding/guideRegistry';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';

/** 渲染六项产品引导目录。 */
export function GuideCenterScreen({ onBack }: { onBack: () => void }) {
  const { formatNumber, t } = useAppLanguage();
  const { startGuide, statuses, templates } = useStarterTour();
  const guides = localizeGuideRegistry(t);
  const statusCopy: Record<GuideStatus, string> = {
    not_started: t('guideCenter.notStarted'),
    completed: t('guideCenter.completed'),
    skipped: t('guideCenter.skipped'),
  };
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <TopLevelPageHeader
        onBack={onBack}
        subtitle={t('guideCenter.subtitle')}
        title={t('guideCenter.title')}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {GUIDE_IDS.map((id) => {
          const guide = guides[id];
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
                    {t('guideCenter.steps', {
                      count: formatNumber(guide.steps.length),
                      status: statusCopy[status],
                    })}
                  </Text>
                </View>
                <Text
                  accessibilityLabel={t('guideCenter.statusAccessibility', {
                    status:
                      status === 'not_started'
                        ? t('guideCenter.incomplete')
                        : t('guideCenter.completed'),
                    title: guide.title,
                  })}
                  style={[styles.status, status === 'completed' && styles.completed]}
                >
                  {statusCopy[status]}
                </Text>
              </View>
              <Text style={styles.description}>{guide.description}</Text>
              {disabled ? (
                <Text style={styles.warning}>{t('guideCenter.templateUnavailable')}</Text>
              ) : null}
              <Pressable
                accessibilityLabel={t('guideCenter.startAccessibility', {
                  action:
                    status === 'not_started' ? t('guideCenter.start') : t('guideCenter.replay'),
                  title: guide.title,
                })}
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
                  {status === 'not_started'
                    ? t('guideCenter.startGuide')
                    : t('guideCenter.replayGuide')}
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
