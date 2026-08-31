/**
 * 知识文档操作抽屉。
 *
 * 根据文档解析状态提供查看、失败原因、重新解析或重新上传入口，避免卡片省略号直接触发
 * 文件选择器或网络写操作。
 *
 * Responsibilities:
 * - 在移动端和 Web 使用一致的底部操作抽屉。
 * - 对处理中、不可重试失败和请求中状态给出明确且不可重复提交的反馈。
 *
 * Notes:
 * - 二次确认、文件选择、导航和网络请求由页面编排器负责。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { KnowledgeDocument } from '@echowave/contracts';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

function ActionItem({
  disabled = false,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={colors.secondary} name={icon} size={22} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function processingLabel(document: KnowledgeDocument): string {
  switch (document.status.kind) {
    case 'queued':
      return '文档正在等待解析，完成前无需重复操作。';
    case 'validating':
      return '正在校验文件内容。';
    case 'parsing':
    case 'chunking':
      return '正在解析文档内容。';
    case 'embedding':
      return `正在生成知识向量（${document.status.progress}%）。`;
    case 'deleting':
      return '文档正在移除。';
    default:
      return '';
  }
}

/** 按文档当前状态渲染安全操作入口。 */
export function KnowledgeDocumentActions({
  document,
  onClose,
  onOpen,
  onReupload,
  onRetry,
  onShowFailure,
  pending,
}: {
  document?: KnowledgeDocument;
  onClose: () => void;
  onOpen: () => void;
  onReupload: () => void;
  onRetry: () => void;
  onShowFailure: () => void;
  pending: boolean;
}) {
  const failedStatus = document?.status.kind === 'failed' ? document.status : undefined;
  const failed = Boolean(failedStatus);
  const migrationFailure = failedStatus?.code === 'EMBEDDING_MODEL_MIGRATION_REQUIRED';
  const statusDescription = document
    ? failed
      ? failedStatus?.retryable || migrationFailure
        ? '请选择需要执行的操作。'
        : '该失败当前不可重试，可查看原因后重新准备文件。'
      : processingLabel(document)
    : '';

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={Boolean(document)}>
      <Pressable accessibilityLabel="关闭文档操作" onPress={onClose} style={styles.backdrop} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {document?.title ?? ''}
        </Text>
        {statusDescription ? <Text style={styles.description}>{statusDescription}</Text> : null}
        {document?.status.kind === 'ready' ? (
          <ActionItem
            disabled={pending}
            icon="document-text-outline"
            label="查看文件"
            onPress={onOpen}
          />
        ) : null}
        {failed ? (
          <ActionItem
            disabled={pending}
            icon="alert-circle-outline"
            label="查看失败原因"
            onPress={onShowFailure}
          />
        ) : null}
        {failedStatus?.retryable && !migrationFailure ? (
          <ActionItem
            disabled={pending}
            icon="refresh-outline"
            label={pending ? '正在重新解析…' : '重新解析'}
            onPress={onRetry}
          />
        ) : null}
        {migrationFailure ? (
          <ActionItem
            disabled={pending}
            icon="cloud-upload-outline"
            label={pending ? '正在处理…' : '重新上传文件'}
            onPress={onReupload}
          />
        ) : null}
        {!failed && document?.status.kind !== 'ready' ? (
          <View accessibilityLiveRegion="polite" style={styles.statusOnly}>
            <Ionicons color={colors.secondary} name="time-outline" size={20} />
            <Text style={styles.statusText}>当前状态暂不可操作</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={onClose}
          style={styles.cancel}
        >
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(16, 24, 40, 0.28)', flex: 1 },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  title: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    paddingBottom: spacing.xs,
  },
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    paddingBottom: spacing.sm,
  },
  action: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 52,
  },
  actionText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  statusOnly: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 52 },
  statusText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  disabled: { opacity: 0.35 },
  pressed: { backgroundColor: colors.background },
  cancel: { alignItems: 'center', minHeight: 48, paddingTop: spacing.md },
  cancelText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
});
