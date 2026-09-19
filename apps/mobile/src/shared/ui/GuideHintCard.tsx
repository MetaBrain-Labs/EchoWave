/**
 * 功能说明卡片。
 *
 * 向尚无引导的主功能页说明该功能能做什么，由顶部栏引导按钮切换显示。
 *
 * Responsibilities:
 * - 渲染功能标题与要点列表。
 * - 复用共享卡片外框与排版令牌，跨平台保持一致。
 *
 * Notes:
 * - 纯展示组件，不含网络与导航；显隐由宿主页面控制。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import {
  guideHintPointKeys,
  guideHintTitleKey,
  type GuideHintNamespace,
} from '@/shared/onboarding/guideHintCopy';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 渲染某个功能的说明卡片。 */
export function GuideHintCard({ namespace }: { namespace: GuideHintNamespace }) {
  const { t } = useAppLanguage();
  return (
    <View accessibilityRole="summary" style={styles.card} testID={`guide-hint-${namespace}`}>
      <View style={styles.headingRow}>
        <Ionicons
          color={colors.secondary}
          name="bulb-outline"
          size={typography.heading3.lineHeight}
        />
        <Text style={styles.title}>{t(guideHintTitleKey(namespace))}</Text>
      </View>
      {guideHintPointKeys(namespace).map((key) => (
        <Text key={key} style={styles.point}>
          • {t(key)}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    padding: spacing.md,
  },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  title: {
    ...typography.heading3,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  point: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
});
