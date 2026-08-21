/**
 * 知识库空状态控件。
 *
 * 为知识库页面的空、加载失败和无匹配内容提供一致提示布局。
 *
 * Responsibilities:
 * - 展示状态标题与辅助说明。
 * - 提供可访问的 alert 语义。
 *
 * Notes:
 * - 重试操作由调用页面单独提供。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';

/** 渲染知识库页面通用的空、加载或失败状态。 */
export function EmptyState({ description, title }: { description: string; title: string }) {
  return (
    <View accessibilityRole="alert" style={styles.emptyState}>
      <Ionicons color={colors.secondary} name="folder-open-outline" size={36} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: spacing.md },
  emptyTitle: {
    ...typography.heading2, color: textColors.primary, fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold', marginTop: spacing.md,
  },
  emptyDescription: {
    ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans,
    marginTop: spacing.sm, textAlign: 'center',
  },
});
