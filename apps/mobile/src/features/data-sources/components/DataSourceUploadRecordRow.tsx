/**
 * 数据源上传记录行。
 *
 * 展示上传成功、上传失败和转写失败的时间线记录。
 *
 * Responsibilities:
 * - 保留重传操作和失败原因可访问性
 *
 * Notes:
 * - 仅渲染 feature 数据并通过回调上报操作，不访问网络或路由。
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

import type { UploadRecord } from '../model';

function showComingSoon(feature: string) {
  Alert.alert('功能建设中', `${feature}将在后续版本开放。`);
}

export function UploadRecordRow({
  onReupload,
  record,
}: {
  onReupload: () => void;
  record: UploadRecord;
}) {
  const failed = record.kind !== 'upload-success';
  const title =
    record.kind === 'upload-success'
      ? '上传成功'
      : record.kind === 'upload-failed'
        ? '上传失败'
        : '转写失败';
  const actionLabel = record.kind === 'upload-failed' ? '重新上传' : '重新转写';
  return (
    <View style={styles.recordRow}>
      <Text style={styles.recordTime}>{record.time}</Text>
      <View style={styles.timelineMarker}>
        <View style={styles.timelineLine} />
        <Ionicons
          color={colors.ink}
          name={failed ? 'alert-circle' : 'ellipse'}
          size={typography.body.lineHeight}
        />
      </View>
      <View style={[styles.recordContent, failed && styles.failedRecordContent]}>
        <Text accessibilityRole={failed ? 'alert' : undefined} style={styles.recordTitle}>
          {title}
        </Text>
        <Text style={styles.recordDescription}>{record.description}</Text>
        <Text style={styles.recordDescription}>{record.detail}</Text>
      </View>
      {failed ? (
        <Pressable
          accessibilityLabel={`${actionLabel}：${record.time}`}
          accessibilityRole="button"
          onPress={record.kind === 'upload-failed' ? onReupload : () => showComingSoon(actionLabel)}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>{actionLabel}</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityLabel={`${record.time}上传记录更多操作`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => showComingSoon('上传记录更多操作')}
          style={({ pressed }) => [styles.recordMoreButton, pressed && styles.pressed]}
        >
          <Ionicons color={colors.secondary} name="ellipsis-horizontal" size={24} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  recordRow: { flexDirection: 'row', minHeight: 116 },
  recordTime: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    paddingTop: spacing.xs,
    width: 84,
  },
  timelineMarker: { alignItems: 'center', width: 28 },
  timelineLine: {
    backgroundColor: colors.divider,
    bottom: 0,
    position: 'absolute',
    top: typography.body.lineHeight,
    width: 2,
  },
  recordContent: { flex: 1, gap: spacing.xs, paddingBottom: spacing.md },
  failedRecordContent: {
    borderLeftColor: colors.ink,
    borderLeftWidth: 2,
    paddingLeft: spacing.sm,
  },
  recordTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  recordDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  retryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.base,
  },
  pressed: { backgroundColor: colors.divider, borderRadius: radii.default },
  retryText: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  recordMoreButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 40 },
});
