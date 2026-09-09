/**
 * 数据源概览内容。
 *
 * 组合实时指标、接入信息和最近音频。
 *
 * Responsibilities:
 * - 呈现概览投影并复用音频行组件
 *
 * Notes:
 * - 仅渲染 feature 数据并通过回调上报操作，不访问网络或路由。
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

import { AudioRow } from './DataSourceAudioRow';
import type { DataSourceDetailView, SourceAudioItem } from '../model';

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

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLabelRow}>
        <Ionicons color={colors.secondary} name={icon} size={typography.description.lineHeight} />
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text numberOfLines={1} style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

export function OverviewContent({
  activeAudioFileId,
  audioLoading,
  audioPlaying,
  onOpenAudioActions,
  onPlayAudio,
  onShowAudioError,
  onShowAudioProgress,
  source,
}: {
  activeAudioFileId?: string;
  audioLoading: boolean;
  audioPlaying: boolean;
  onOpenAudioActions: (audio: SourceAudioItem) => void;
  onPlayAudio: (audio: SourceAudioItem) => void;
  onShowAudioError: (audio: SourceAudioItem) => void;
  onShowAudioProgress: (audio: SourceAudioItem) => void;
  source: DataSourceDetailView;
}) {
  const { formatNumber, t } = useAppLanguage();
  const completedCount = source.audioItems.filter((item) => item.status.kind === 'complete').length;
  const pendingCount = source.audioItems.length - completedCount;
  return (
    <View style={styles.overviewContent}>
      <Text style={styles.sectionTitle}>{t('sourceOverview.details')}</Text>
      <Text style={styles.recentUpload}>
        {t('sourceOverview.recentUpload', { date: source.uploadedAt })}
      </Text>
      <View style={styles.metrics}>
        <Metric
          label={t('sourceOverview.audioCount')}
          value={formatNumber(source.audioItems.length)}
        />
        <Metric divider label={t('sourceOverview.totalDuration')} value={source.totalDuration} />
        <Metric
          divider
          label={t('sourceOverview.transcribed')}
          value={formatNumber(completedCount)}
        />
        <Metric divider label={t('sourceOverview.pending')} value={formatNumber(pendingCount)} />
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>{t('sourceForm.audioAccess')}</Text>
        <InfoRow
          icon="cloud-upload-outline"
          label={t('sourceForm.accessMethod')}
          value={t('sourceForm.manualUpload')}
        />
        <InfoRow
          icon="grid-outline"
          label={t('sourceForm.storageLocation')}
          value={source.location === 'local' ? t('sourceForm.local') : t('knowledgeDetail.cloud')}
        />
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>{t('sourceForm.audioAnalysis')}</Text>
        <InfoRow
          icon="hardware-chip-outline"
          label={t('sourceForm.transcriptionModel')}
          value={source.analysisModel}
        />
        <InfoRow
          icon="happy-outline"
          label={t('sourceOverview.emotion')}
          value={
            source.emotionAnalysis ? t('sourceOverview.enabled') : t('sourceOverview.disabled')
          }
        />
        <InfoRow
          icon="people-outline"
          label={t('sourceOverview.speaker')}
          value={source.roleSeparation ? t('sourceOverview.enabled') : t('sourceOverview.disabled')}
        />
        <InfoRow
          icon="copy-outline"
          label={t('sourceOverview.scene')}
          value={
            source.sceneSeparation ? t('sourceOverview.enabled') : t('sourceOverview.disabled')
          }
        />
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>{t('sourceOverview.processing')}</Text>
        <InfoRow
          icon="stats-chart-outline"
          label={t('sourceOverview.transcriptionMethod')}
          value={source.autoTranscribe ? t('sourceOverview.automatic') : t('sourceOverview.manual')}
        />
        <InfoRow
          icon="arrow-redo-outline"
          label={t('sourceOverview.skipInvalid')}
          value={
            source.skipInvalidAudio ? t('sourceOverview.enabled') : t('sourceOverview.disabled')
          }
        />
      </View>

      <View style={styles.recentAudioSection}>
        <Text style={styles.sectionTitle}>{t('sourceOverview.recentAudio')}</Text>
        {source.audioItems.length === 0 ? (
          <Text style={styles.listEmptyText}>{t('sourceOverview.noAudio')}</Text>
        ) : (
          source.audioItems
            .slice(0, 3)
            .map((item) => (
              <AudioRow
                active={activeAudioFileId === item.id}
                item={item}
                key={item.id}
                loading={activeAudioFileId === item.id && audioLoading}
                onMore={() => onOpenAudioActions(item)}
                onPlay={() => onPlayAudio(item)}
                onShowError={() => onShowAudioError(item)}
                onShowProgress={() => onShowAudioProgress(item)}
                playing={activeAudioFileId === item.id && audioPlaying}
              />
            ))
        )}
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
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoLabelRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  infoLabel: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  infoValue: {
    ...typography.description,
    color: textColors.secondary,
    flexShrink: 1,
    fontFamily: fontFamilies.sans,
    marginLeft: spacing.md,
    textAlign: 'right',
  },
  overviewContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  sectionTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  recentUpload: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.md,
  },
  metrics: { flexDirection: 'row', marginTop: spacing.lg },
  infoSection: { gap: spacing.base, marginTop: spacing.xl },
  recentAudioSection: { gap: spacing.sm, marginTop: spacing.xl },
  listEmptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
});
