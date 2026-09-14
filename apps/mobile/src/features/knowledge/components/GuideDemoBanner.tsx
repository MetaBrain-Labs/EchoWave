/**
 * 知识库引导演示提示。
 *
 * 在真实页面结构中明确标记本地只读数据，避免用户把示例知识库误认为服务器内容。
 *
 * Responsibilities:
 * - 展示统一的只读演示声明。
 *
 * Notes:
 * - 组件不包含任何操作入口，也不会触发网络请求。
 */
import { StyleSheet, Text, View } from 'react-native';

import { radii, spacing, textColors, typography } from '@/shared/theme/tokens';

/** 渲染知识库演示模式的只读声明。 */
export function GuideDemoBanner() {
  return (
    <View accessibilityRole="text" style={styles.banner} testID="knowledge-guide-demo-banner">
      <Text style={styles.title}>引导演示模式</Text>
      <Text style={styles.body}>
        以下知识库、文档、文本块和回答均为本地只读示例，不会创建、修改或保存服务器数据。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#FFF4E8',
    borderColor: '#FFD7A8',
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  title: { ...typography.body, color: textColors.primary, fontWeight: '700' },
  body: { ...typography.description, color: textColors.secondary },
});
