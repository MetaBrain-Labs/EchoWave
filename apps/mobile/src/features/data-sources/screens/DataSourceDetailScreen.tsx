/**
 * 数据源详情页面。
 *
 * 组合数据源概览、音频文件、上传记录和关联分组四个同级页面。
 *
 * Responsibilities:
 * - 根据数据源标识读取并组合服务端只读详情。
 * - 协调标签点击、横向滑动、独立纵向滚动和固定操作栏。
 * - 为尚未接入的搜索、上传、转写、重试和关联操作提供明确反馈。
 *
 * Notes:
 * - 页面不持久化筛选、分页或操作栏交互状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSwipePager } from '@/shared/hooks/useSwipePager';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PageTabs } from '@/shared/ui/PageTabs';
import {
  getDataSource,
  listDataSourceAudioFiles,
  listDataSourceGroups,
  listDataSourceIngestionRecords,
} from '@/shared/api/workspaceApi';

import {
  toDataSourceDetailView,
  type DataSourceDetailView,
  type SourceAudioItem,
  type SourceAudioStatus,
  type UploadRecord,
} from '../model';
import type { LinkedDataSourceGroup } from '@echowave/contracts';

const detailTabs = [
  { key: 'overview', label: '概览' },
  { key: 'audio', label: '音频文件' },
  { key: 'uploads', label: '上传记录' },
  { key: 'groups', label: '关联分组' },
] as const;
type DetailTab = (typeof detailTabs)[number]['key'];
const detailTabKeys = detailTabs.map((tab) => tab.key);

function showComingSoon(feature: string) {
  Alert.alert('功能建设中', `${feature}将在后续版本开放。`);
}

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

function AudioStatusView({ status }: { status: SourceAudioStatus }) {
  switch (status.kind) {
    case 'complete':
      return null;
    case 'uploading':
      return (
        <View style={styles.inlineStatus}>
          <ActivityIndicator color={colors.ink} size={typography.body.lineHeight} />
          <Text style={styles.statusText}>上传中</Text>
        </View>
      );
    case 'transcribing':
      return <Text style={styles.statusText}>转写中 ({status.progress}%)</Text>;
    case 'waiting':
      return (
        <View style={styles.inlineStatus}>
          <Ionicons color={colors.ink} name="hourglass-outline" size={typography.body.lineHeight} />
          <Text style={styles.statusText}>待转写</Text>
        </View>
      );
    case 'upload-failed':
      return (
        <View accessibilityRole="alert" style={styles.inlineStatus}>
          <Ionicons
            color={colors.ink}
            name="alert-circle-outline"
            size={typography.body.lineHeight}
          />
          <Text style={styles.failureStatusText}>上传失败</Text>
        </View>
      );
    case 'transcription-failed':
      return (
        <View accessibilityRole="alert" style={styles.inlineStatus}>
          <Ionicons
            color={colors.ink}
            name="alert-circle-outline"
            size={typography.body.lineHeight}
          />
          <Text style={styles.failureStatusText}>转写失败</Text>
        </View>
      );
  }
}

function AudioRow({ item }: { item: SourceAudioItem }) {
  return (
    <View style={styles.audioRow}>
      <Pressable
        accessibilityLabel={`播放音频：${item.title}`}
        accessibilityRole="button"
        onPress={() => showComingSoon('音频播放')}
        style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
      >
        <Ionicons color={colors.secondary} name="play" size={typography.heading1.lineHeight} />
      </Pressable>
      <View style={styles.audioMain}>
        <Text numberOfLines={1} style={styles.audioTitle}>
          {item.title}
        </Text>
        <Text style={styles.audioMeta}>
          {item.duration} · {item.createdAt}
        </Text>
      </View>
      <AudioStatusView status={item.status} />
      <Pressable
        accessibilityLabel={`${item.title}更多操作`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => showComingSoon('音频更多操作')}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
      >
        <Ionicons color={colors.ink} name="ellipsis-vertical" size={24} />
      </Pressable>
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

function OverviewContent({ source }: { source: DataSourceDetailView }) {
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
          label="角色分离"
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
        {source.audioItems.slice(0, 3).map((item) => (
          <AudioRow item={item} key={item.id} />
        ))}
      </View>
    </View>
  );
}

function UploadRecordRow({ record }: { record: UploadRecord }) {
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
          onPress={() => showComingSoon(actionLabel)}
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

function GroupCard({ group }: { group: LinkedDataSourceGroup }) {
  return (
    <View style={styles.groupCard}>
      <View style={styles.groupTitleRow}>
        <Text style={styles.groupTitle}>{group.name}</Text>
        <Ionicons
          color={colors.secondary}
          name="swap-horizontal"
          size={typography.heading2.lineHeight}
        />
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

function ActionButton({
  icon,
  label,
  onPress,
  emphasized = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  emphasized?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        emphasized && styles.emphasizedActionButton,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={colors.ink} name={icon} size={typography.body.lineHeight} />
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

function FixedActions({ activeTab }: { activeTab: DetailTab }) {
  if (activeTab === 'groups') {
    return (
      <View style={styles.fixedActions} testID="data-source-fixed-actions">
        <ActionButton
          emphasized
          icon="add"
          label="关联新分组"
          onPress={() => showComingSoon('关联新分组')}
        />
      </View>
    );
  }
  if (activeTab === 'uploads') {
    return (
      <View style={styles.fixedActions} testID="data-source-fixed-actions">
        <ActionButton
          emphasized
          icon="cloud-upload-outline"
          label="上传音频"
          onPress={() => showComingSoon('上传音频')}
        />
      </View>
    );
  }
  return (
    <View style={styles.fixedActions} testID="data-source-fixed-actions">
      <ActionButton
        icon="create-outline"
        label="全部转写"
        onPress={() => showComingSoon('全部转写')}
      />
      <ActionButton
        emphasized
        icon="cloud-upload-outline"
        label="上传音频"
        onPress={() => showComingSoon('上传音频')}
      />
    </View>
  );
}

/** 渲染数据源详情及四个可点击、可滑动的同级页面。 */
export function DataSourceDetailScreen({
  onBack,
  sourceId,
}: {
  onBack: () => void;
  sourceId: string;
}) {
  const [source, setSource] = useState<DataSourceDetailView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } = useSwipePager({
    activeTab,
    onTabChange: setActiveTab,
    tabs: detailTabKeys,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [detail, audio, records, groups] = await Promise.all([
        getDataSource(sourceId),
        listDataSourceAudioFiles(sourceId),
        listDataSourceIngestionRecords(sourceId),
        listDataSourceGroups(sourceId),
      ]);
      setSource(toDataSourceDetailView(detail, audio.items, records.items, groups.items));
    } catch (reason) {
      setSource(undefined);
      setError(reason instanceof Error ? reason.message : '数据源加载失败。');
    } finally {
      setLoading(false);
    }
  }, [sourceId]);
  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <PageHeader onBack={onBack} onMore={() => showComingSoon('更多操作')} title="数据源详情" />
        <ActivityIndicator
          accessibilityLabel="正在加载数据源详情"
          color={colors.ink}
          style={styles.loading}
        />
      </SafeAreaView>
    );
  }

  if (!source) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <PageHeader onBack={onBack} onMore={() => showComingSoon('更多操作')} title="数据源详情" />
        <View style={styles.emptyState}>
          <Ionicons color={colors.secondary} name="git-network-outline" size={40} />
          <Text style={styles.emptyTitle}>
            {error.includes('不存在') ? '未找到数据源' : '数据源加载失败'}
          </Text>
          <Text accessibilityRole="alert" style={styles.emptyDescription}>
            {error || '该数据源可能已移除，请返回数据源列表。'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>重新加载</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const renderTabs = () => (
    <View style={styles.tabsSurface}>
      <PageTabs activeTab={activeTab} onChange={selectTab} tabs={detailTabs} />
    </View>
  );
  const uploadDates = [...new Set(source.uploadRecords.map((record) => record.date))];

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <PageHeader
        onBack={onBack}
        onMore={() => showComingSoon('数据源更多操作')}
        onSearch={() => showComingSoon('数据源详情搜索')}
        searchLabel="搜索数据源内容"
        title={source.name}
      />
      <ScrollView
        directionalLockEnabled
        horizontal
        nestedScrollEnabled
        onMomentumScrollEnd={handleMomentumScrollEnd}
        pagingEnabled
        ref={pagerRef}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        testID="data-source-detail-pager"
      >
        <ScrollView
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[1]}
          style={[styles.page, { width: pageWidth }]}
          testID="data-source-overview-scroll"
        >
          <View style={styles.hero}>
            <Text accessibilityRole="header" style={styles.heroTitle}>
              {source.name}
            </Text>
            <Text style={styles.heroDescription}>{source.description}</Text>
            <Text style={styles.heroMeta}>
              {source.connection}　接入 {source.linkedGroupCount} 个分组
            </Text>
          </View>
          {renderTabs()}
          <OverviewContent source={source} />
        </ScrollView>

        <ScrollView
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
          style={[styles.page, { width: pageWidth }]}
          testID="data-source-audio-scroll"
        >
          {renderTabs()}
          <View style={styles.audioList}>
            {source.audioItems.map((item) => (
              <AudioRow item={item} key={item.id} />
            ))}
          </View>
        </ScrollView>

        <ScrollView
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
          style={[styles.page, { width: pageWidth }]}
          testID="data-source-uploads-scroll"
        >
          {renderTabs()}
          <View style={styles.recordsList}>
            {uploadDates.map((date, index) => (
              <View key={date} style={[styles.recordGroup, index > 0 && styles.recordGroupDivider]}>
                <Text style={styles.recordDate}>{date}</Text>
                {source.uploadRecords
                  .filter((record) => record.date === date)
                  .map((record) => (
                    <UploadRecordRow key={record.id} record={record} />
                  ))}
              </View>
            ))}
          </View>
        </ScrollView>

        <ScrollView
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
          style={[styles.page, { width: pageWidth }]}
          testID="data-source-groups-scroll"
        >
          {renderTabs()}
          <View style={styles.groupList}>
            {source.linkedGroups.map((group) => (
              <GroupCard group={group} key={group.id} />
            ))}
          </View>
        </ScrollView>
      </ScrollView>
      <FixedActions activeTab={activeTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.card, flex: 1 },
  pager: { flex: 1 },
  page: { height: '100%' },
  pageContent: { paddingBottom: spacing.lg },
  tabsSurface: {
    backgroundColor: colors.card,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  hero: {
    backgroundColor: colors.canvas,
    gap: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
  },
  heroTitle: {
    ...typography.contentDisplay,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  heroDescription: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  heroMeta: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
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
  infoSection: { gap: spacing.base, marginTop: spacing.xl },
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
  recentAudioSection: { gap: spacing.sm, marginTop: spacing.xl },
  audioList: { paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  audioRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 84,
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.round,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  audioMain: { flex: 1, gap: spacing.xs, marginLeft: spacing.base },
  audioTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  audioMeta: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  inlineStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginLeft: spacing.sm,
  },
  statusText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  failureStatusText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  moreButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    marginLeft: spacing.sm,
    width: 28,
  },
  pressed: { backgroundColor: colors.divider, borderRadius: radii.default },
  recordsList: { paddingHorizontal: spacing.md },
  recordGroup: { paddingBottom: spacing.md, paddingTop: spacing.lg },
  recordGroupDivider: { borderTopColor: colors.divider, borderTopWidth: 1 },
  recordDate: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginBottom: spacing.md,
  },
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
  retryText: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  recordMoreButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 40 },
  groupList: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  groupCard: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.xl,
    minHeight: 164,
    padding: spacing.lg,
  },
  groupTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  groupTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  groupMetrics: { flexDirection: 'row' },
  fixedActions: {
    backgroundColor: colors.card,
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  emphasizedActionButton: { borderColor: colors.ink, borderWidth: 2 },
  actionButtonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  loading: { marginTop: spacing.xxl },
  emptyTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  emptyDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
});
