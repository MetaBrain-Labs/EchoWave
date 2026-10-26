/**
 * 桌面资源表格。
 *
 * 使用同一套行列结构呈现桌面列表，并保留适合键盘和屏幕阅读器的整行访问方式。
 *
 * Responsibilities:
 * - 绘制可配置列和数据行。
 * - 为整行导航提供明确的可访问名称。
 *
 * Notes:
 * - 只负责布局，不过滤、排序或修改业务数据。
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 桌面表格列的标题和单元格渲染规则。 */
export type DesktopDataTableColumn<Row> = {
  id: string;
  label: string;
  width?: number;
  flex?: number;
  render: (row: Row) => ReactNode;
};

/** 使用业务拥有的 key 渲染列表，避免表格组件持有任何数据状态。 */
export function DesktopDataTable<Row>({
  columns,
  getRowKey,
  getRowAccessibilityLabel,
  label,
  onRowPress,
  rows,
  rowStyle,
  testID,
}: {
  columns: readonly DesktopDataTableColumn<Row>[];
  getRowKey: (row: Row) => string;
  getRowAccessibilityLabel?: (row: Row) => string;
  label: string;
  onRowPress?: (row: Row) => void;
  rows: readonly Row[];
  rowStyle?: ViewStyle;
  testID?: string;
}) {
  return (
    <View accessibilityLabel={label} style={styles.table} testID={testID}>
      <View style={styles.header}>
        {columns.map((column) => (
          <View key={column.id} style={[styles.cell, columnStyle(column.width, column.flex)]}>
            <Text accessibilityRole="header" style={styles.headerText}>
              {column.label}
            </Text>
          </View>
        ))}
      </View>
      {rows.map((row) => {
        const content = columns.map((column) => (
          <View key={column.id} style={[styles.cell, columnStyle(column.width, column.flex)]}>
            {column.render(row)}
          </View>
        ));
        const key = getRowKey(row);
        return onRowPress ? (
          <Pressable
            accessibilityLabel={getRowAccessibilityLabel?.(row)}
            accessibilityRole="button"
            key={key}
            onPress={() => onRowPress(row)}
            style={({ pressed }) => [styles.row, rowStyle, pressed && styles.rowPressed]}
          >
            {content}
          </Pressable>
        ) : (
          <View key={key} style={[styles.row, rowStyle]}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

/** 将固定列宽与弹性列宽统一映射到同一个 flex 行模型。 */
function columnStyle(width?: number, flex?: number): ViewStyle {
  if (width !== undefined) return { flexBasis: width, flexGrow: 0, flexShrink: 0, width };
  return { flex: flex ?? 1, minWidth: 0 };
}

const styles = StyleSheet.create({
  table: {
    alignSelf: 'stretch',
    backgroundColor: colors.card,
    borderColor: colors.borderSoft,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  headerText: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 62,
    paddingHorizontal: spacing.md,
  },
  rowPressed: { backgroundColor: colors.background },
  cell: { justifyContent: 'center', minWidth: 0, paddingHorizontal: spacing.xs },
});
