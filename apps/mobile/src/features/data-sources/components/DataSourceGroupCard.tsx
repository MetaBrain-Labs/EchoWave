/**
 * 数据源关联分组卡片。
 *
 * 展示关联分组的实时指标和切换、解除动作。
 *
 * Responsibilities:
 * - 保持分组关系操作由页面确认流程执行
 *
 * Notes:
 * - 仅渲染 feature 数据并通过回调上报操作，不访问网络或路由。
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import type { LinkedDataSourceGroup } from '@echowave/contracts';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

function Metric({
  divider = false,
  label,
  value,
}: {
  divider?: boolean;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.metric, divider && styles.metricDivider]}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export function GroupCard({
  group,
  onSwitch,
  onUnlink,
}: {
  group: LinkedDataSourceGroup;
  onSwitch: () => void;
  onUnlink: () => void;
}) {
  return (
    <View style={styles.groupCard}>
      <View style={styles.groupTitleRow}>
        <Text style={styles.groupTitle}>{group.name}</Text>
        <View style={styles.groupActions}>
          <Pressable
            accessibilityLabel={`切换到分组：${group.name}`}
            accessibilityRole="button"
            onPress={onSwitch}
            style={styles.groupIconButton}
          >
            <Ionicons
              color={colors.secondary}
              name="swap-horizontal"
              size={typography.heading2.lineHeight}
            />
          </Pressable>
          <Pressable
            accessibilityLabel={`解除关联分组：${group.name}`}
            accessibilityRole="button"
            onPress={onUnlink}
            style={styles.groupIconButton}
          >
            <Ionicons
              color={colors.secondary}
              name="unlink-outline"
              size={typography.heading2.lineHeight}
            />
          </Pressable>
        </View>
      </View>
      <View style={styles.groupMetrics}>
        <Metric label="分析数" value={`${group.analysisCount}`} />
        <Metric divider label="音频数" value={`${group.audioCount}`} />
        <Metric divider label="知识库" value={`${group.knowledgeCount}`} />
        <Metric divider label="数据源" value={`${group.sourceCount}`} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  metric: { alignItems: 'center', flex: 1, gap: spacing.sm },
  metricDivider: {
    borderLeftColor: colors.divider,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  metricValue: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  metricLabel: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  groupCard: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.base,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
  },
  groupTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  groupTitle: {
    ...typography.heading2,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  groupActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  groupIconButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  groupMetrics: { flexDirection: 'row' },
});
