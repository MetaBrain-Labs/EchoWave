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
import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

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

function processingLabel(
  document: KnowledgeDocument,
  t: ReturnType<typeof useAppLanguage>['t'],
): string {
  switch (document.status.kind) {
    case 'queued':
      return t('documentActions.waiting');
    case 'validating':
      return t('documentActions.validating');
    case 'parsing':
    case 'chunking':
      return t('documentActions.parsing');
    case 'embedding':
      return t('documentActions.embedding', { progress: document.status.progress });
    case 'deleting':
      return t('documentActions.deleting');
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
  onReindex,
  onShowFailure,
  pending,
  onRename,
  onReplace,
  onDelete,
  error,
}: {
  document?: KnowledgeDocument;
  onClose: () => void;
  onOpen: () => void;
  onReupload: () => void;
  onRetry: () => void;
  onReindex?: () => void;
  onShowFailure: () => void;
  pending: boolean;
  onRename?: () => void;
  onReplace?: () => void;
  onDelete?: () => void;
  error?: string;
}) {
  const { t } = useAppLanguage();
  const failedStatus =
    document?.latestRevision?.error ??
    (document?.status.kind === 'failed' ? document.status : undefined);
  const failed = Boolean(failedStatus);
  const migrationFailure = failedStatus?.code === 'EMBEDDING_MODEL_MIGRATION_REQUIRED';
  const statusDescription = document
    ? failed
      ? failedStatus?.retryable || migrationFailure
        ? t('documentActions.choose')
        : t('documentActions.notRetryable')
      : processingLabel(document, t)
    : '';

  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (!pending) onClose();
      }}
      transparent
      visible={Boolean(document)}
    >
      <Pressable
        accessibilityLabel={t('documentActions.close')}
        disabled={pending}
        onPress={onClose}
        style={styles.backdrop}
      />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {document?.title ?? ''}
        </Text>
        {document?.activeRevisionId &&
        document.latestRevision &&
        document.latestRevision.id !== document.activeRevisionId ? (
          <Text style={styles.description}>
            {t('knowledgeEdit.oldActive')} {document.latestRevision.title} ·{' '}
            {document.latestRevision.progress}%
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.description}>
            {error}
          </Text>
        ) : null}
        {statusDescription ? <Text style={styles.description}>{statusDescription}</Text> : null}
        {document?.status.kind === 'ready' ? (
          <>
            <ActionItem
              disabled={pending}
              icon="document-text-outline"
              label={t('documentActions.view')}
              onPress={onOpen}
            />
            {!document.caseId && onReindex ? (
              <ActionItem
                disabled={pending}
                icon="sync-outline"
                label={t(
                  document.needsReindex
                    ? 'documentActions.reindexRecommended'
                    : 'documentActions.reindex',
                )}
                onPress={onReindex}
              />
            ) : null}
          </>
        ) : null}
        {failed ? (
          <ActionItem
            disabled={pending}
            icon="alert-circle-outline"
            label={t('documentActions.failure')}
            onPress={onShowFailure}
          />
        ) : null}
        {failedStatus?.retryable && !migrationFailure ? (
          <ActionItem
            disabled={pending}
            icon="refresh-outline"
            label={pending ? t('documentActions.reparsing') : t('documentDetail.reparse')}
            onPress={onRetry}
          />
        ) : null}
        {migrationFailure ? (
          <ActionItem
            disabled={pending}
            icon="cloud-upload-outline"
            label={pending ? t('documentActions.processing') : t('documentActions.reupload')}
            onPress={onReupload}
          />
        ) : null}
        {document && !['deleting', 'deleted'].includes(document.status.kind) ? (
          <>
            {onRename && (
              <ActionItem
                disabled={pending}
                icon="create-outline"
                label={t('knowledgeEdit.rename')}
                onPress={onRename}
              />
            )}
            {onReplace && (
              <ActionItem
                disabled={pending}
                icon="cloud-upload-outline"
                label={t('knowledgeEdit.replace')}
                onPress={onReplace}
              />
            )}
            {onDelete && (
              <ActionItem
                disabled={pending}
                icon="trash-outline"
                label={t('knowledgeEdit.delete')}
                onPress={onDelete}
              />
            )}
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={onClose}
          style={styles.cancel}
        >
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
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
