/**
 * 知识文档展示控件。
 *
 * 集中文档格式、处理状态和标准操作按钮的视觉映射。
 *
 * Responsibilities:
 * - 将文档格式映射为稳定图标。
 * - 将服务器处理状态映射为中文状态展示。
 * - 提供统一操作按钮。
 *
 * Notes:
 * - 不改变或轮询文档状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DocumentFormat, KnowledgeDocument } from '@echowave/contracts';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 渲染具有统一图标与反馈语义的操作按钮。 */
export function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
    >
      <Ionicons color={colors.ink} name={icon} size={typography.body.lineHeight} />
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

/** 按文档格式渲染一致的 Expo 图标。 */
export function DocumentFormatIcon({
  format,
  size = 36,
}: {
  format: DocumentFormat;
  size?: number;
}) {
  const { t } = useAppLanguage();
  const config: Record<DocumentFormat, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
    markdown: { color: '#526071', icon: 'document-text-outline' },
    word: { color: '#1768c4', icon: 'document-outline' },
    spreadsheet: { color: '#078449', icon: 'grid-outline' },
  };
  return (
    <Ionicons
      accessibilityLabel={t('documentUi.file', { format })}
      color={config[format].color}
      name={config[format].icon}
      size={size}
    />
  );
}

/** 将服务器文档处理状态映射为稳定、可理解的中文展示。 */
export function DocumentStatusView({ document }: { document: KnowledgeDocument }) {
  const { formatNumber, t } = useAppLanguage();
  switch (document.status.kind) {
    case 'ready':
      return (
        <Text style={styles.statusText}>
          {t('documentUi.blocks', { count: formatNumber(document.vectorCount) })}
        </Text>
      );
    case 'queued':
      return <InlineStatus icon="hourglass-outline" label={t('knowledgeDetail.queued')} />;
    case 'validating':
      return <InlineStatus icon="sync-outline" label={t('documentUi.uploading')} />;
    case 'parsing':
    case 'chunking':
      return <Text style={styles.statusText}>{t('documentUi.parsing')}</Text>;
    case 'embedding':
      return (
        <Text style={styles.statusText}>
          {t('documentUi.embedding', { progress: formatNumber(document.status.progress) })}
        </Text>
      );
    case 'deleting':
      return <Text style={styles.statusText}>{t('documentUi.deleting')}</Text>;
    case 'failed':
      return (
        <View style={styles.failedStatus}>
          <Ionicons
            color="#ff5964"
            name="alert-circle-outline"
            size={typography.label.lineHeight}
          />
          <Text style={styles.statusText}>{t('knowledgeDetail.failed')}</Text>
        </View>
      );
  }
}

function InlineStatus({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.inlineStatus}>
      <Ionicons color={colors.ink} name={icon} size={typography.label.lineHeight} />
      <Text style={styles.statusText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: colors.background },
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  actionButtonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  statusText: { ...typography.label, color: textColors.primary, fontFamily: fontFamilies.sans },
  inlineStatus: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  failedStatus: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: '#ff5964',
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
});
