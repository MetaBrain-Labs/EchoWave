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
  const completedCount = source.audioItems.filter((item) => item.status.kind === 'complete').length;
  const pendingCount = source.audioItems.length - completedCount;
  return (
    <View style={styles.overviewContent}>
      <Text style={styles.sectionTitle}>数据源详情</Text>
      <Text style={styles.recentUpload}>最近上传　{source.uploadedAt}:00</Text>
      <View style={styles.metrics}>
        <Metric label="音频数" value={`${source.audioItems.length}`} />
        <Metric divider label="总时长" value={source.totalDuration} />
        <Metric divider label="已转写" value={`${completedCount}`} />
        <Metric divider label="待处理" value={`${pendingCount}`} />
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>音频接入</Text>
        <InfoRow icon="cloud-upload-outline" label="接入方式" value="手动上传" />
        <InfoRow
          icon="grid-outline"
          label="存储位置"
          value={source.location === 'local' ? '本地' : '云端'}
        />
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>音频分析</Text>
        <InfoRow icon="hardware-chip-outline" label="转写模型" value={source.analysisModel} />
        <InfoRow
          icon="happy-outline"
          label="情绪分析"
          value={source.emotionAnalysis ? '已开启' : '未开启'}
        />
        <InfoRow
          icon="people-outline"
          label="说话人分离"
          value={source.roleSeparation ? '已开启' : '未开启'}
        />
        <InfoRow
          icon="copy-outline"
          label="场景分离"
          value={source.sceneSeparation ? '已开启' : '未开启'}
        />
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>音频处理</Text>
        <InfoRow
          icon="stats-chart-outline"
          label="转写方式"
          value={source.autoTranscribe ? '自动转写' : '手动转写'}
        />
        <InfoRow
          icon="arrow-redo-outline"
          label="跳过无效音频"
          value={source.skipInvalidAudio ? '已开启' : '未开启'}
        />
      </View>

      <View style={styles.recentAudioSection}>
        <Text style={styles.sectionTitle}>近期音频</Text>
        {source.audioItems.length === 0 ? (
          <Text style={styles.listEmptyText}>暂无音频，上传后会在这里显示。</Text>
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
