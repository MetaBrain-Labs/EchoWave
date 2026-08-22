/**
 * 通用占位页面。
 *
 * 为尚未实现的产品区域提供一致、可访问且不会误示为真实功能的说明界面。
 *
 * Responsibilities:
 * - 展示标题、说明与可选图标。
 * - 保持原生和 Web 布局一致。
 *
 * Notes:
 * - 不承载业务交互或持久化状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

type PlaceholderScreenProps = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
};

/** 渲染未进入当前里程碑产品区域的一致占位反馈。 */
export function PlaceholderScreen({ title, description, icon }: PlaceholderScreenProps) {
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons color={colors.ink} name={icon} size={34} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>功能建设中</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  content: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.round,
    height: 76,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 76,
  },
  title: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginBottom: spacing.sm,
  },
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    maxWidth: 310,
    textAlign: 'center',
  },
  badge: {
    backgroundColor: colors.successSurface,
    borderRadius: radii.round,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  badgeText: {
    ...typography.label,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
});
