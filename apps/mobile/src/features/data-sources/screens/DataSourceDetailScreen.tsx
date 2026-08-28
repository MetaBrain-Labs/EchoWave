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
import type {
  AudioTranscriptionCapabilitiesResponse,
  AudioTranscriptionPreprocessing,
  GroupSummary,
  LinkedDataSourceGroup,
} from '@echowave/contracts';
import { DEFAULT_AUDIO_TRANSCRIPTION_MODEL } from '@echowave/contracts';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useAudioPlayback } from '@/shared/audio/useAudioPlayback';
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
  getAudioTranscriptionCapabilities,
  archiveDataSource,
  archiveDataSourceAudioFile,
  linkDataSourceGroups,
  listGroups,
  listDataSourceAudioFiles,
  listDataSourceGroups,
  listDataSourceIngestionRecords,
  startAudioTranscription,
  unlinkDataSourceGroup,
  updateDataSource,
  uploadDataSourceAudioFiles,
} from '@/shared/api/workspaceApi';

import {
  AudioTranscriptionConfirmDialog,
  DataSourceConfirmDialog,
  DataSourceFormSheet,
  DataSourceGroupPicker,
  type DataSourceFormValue,
} from '../components/DataSourceDialogs';
import { DataSourceAudioActions } from '../components/DataSourceAudioActions';
import { AnalysisGroupPicker } from '../components/AnalysisGroupPicker';
import { AudioTranscriptionErrorDialog } from '../components/AudioTranscriptionErrorDialog';
import {
  AudioTranscriptionProgressDialog,
  audioTranscriptionStageLabel,
} from '../components/AudioTranscriptionProgressDialog';

import {
  toDataSourceDetailView,
  type DataSourceDetailView,
  type SourceAudioItem,
  type SourceAudioStatus,
  type UploadRecord,
} from '../model';

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

function AudioStatusView({
  onShowError,
  onShowProgress,
  status,
}: {
  onShowError: () => void;
  onShowProgress: () => void;
  status: SourceAudioStatus;
}) {
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
      return (
        <Pressable
          accessibilityLabel="查看转写进度"
          accessibilityRole="button"
          onPress={onShowProgress}
          style={({ pressed }) => [styles.processingStatus, pressed && styles.pressed]}
        >
          <View style={styles.processingTitleRow}>
            <Text numberOfLines={1} style={styles.processingTitle}>
              {status.activity
                ? `${audioTranscriptionStageLabel(status.activity.stage)}${['transcribing', 'validating', 'splitting'].includes(status.activity.stage) && status.activity.chunkIndex !== null ? ` · Chunk ${status.activity.chunkIndex}/${status.activity.chunkCount}` : ''}`
                : '正在转写'}
            </Text>
            <Text style={styles.processingPercent}>{status.progress}%</Text>
          </View>
          <View style={styles.processingProgressTrack}>
            <View
              style={[
                styles.processingProgressFill,
                { width: `${Math.min(100, status.progress)}%` },
              ]}
            />
          </View>
          <Text numberOfLines={1} style={styles.processingAttempts}>
            {status.activity?.networkAttempt !== null &&
            status.activity?.networkAttempt !== undefined
              ? `网络尝试 ${status.activity.networkAttempt}/3`
              : '点击查看详细执行阶段'}
          </Text>
        </Pressable>
      );
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
        <Pressable
          accessibilityLabel="查看转写失败详情"
          accessibilityRole="button"
          onPress={onShowError}
          style={({ pressed }) => [styles.inlineStatus, pressed && styles.pressed]}
        >
          <Ionicons
            color={colors.ink}
            name="alert-circle-outline"
            size={typography.body.lineHeight}
          />
          <Text style={styles.failureStatusText}>转写失败</Text>
        </Pressable>
      );
  }
}

function AudioRow({
  active,
  item,
  loading,
  onMore,
  onPlay,
  onShowError,
  onShowProgress,
  playing,
}: {
  active: boolean;
  item: SourceAudioItem;
  loading: boolean;
  onMore: () => void;
  onPlay: () => void;
  onShowError: () => void;
  onShowProgress: () => void;
  playing: boolean;
}) {
  const playbackDisabled = item.status.kind === 'uploading' || item.status.kind === 'upload-failed';
  return (
    <View style={styles.audioRow}>
      <Pressable
        accessibilityLabel={`${active && playing ? '暂停' : '播放'}音频：${item.title}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: playbackDisabled }}
        disabled={playbackDisabled}
        onPress={onPlay}
        style={({ pressed }) => [
          styles.playButton,
          playbackDisabled && styles.disabledButton,
          pressed && styles.pressed,
        ]}
      >
        {active && loading ? (
          <ActivityIndicator color={colors.secondary} />
        ) : (
          <Ionicons
            color={colors.secondary}
            name={active && playing ? 'pause' : 'play'}
            size={typography.heading1.lineHeight}
          />
        )}
      </Pressable>
      <View style={styles.audioMain}>
        <Text numberOfLines={1} style={styles.audioTitle}>
          {item.title}
        </Text>
        <Text style={styles.audioMeta}>
          {item.duration} · {item.createdAt}
        </Text>
        <AudioStatusView
          onShowError={onShowError}
          onShowProgress={onShowProgress}
          status={item.status}
        />
      </View>
      <Pressable
        accessibilityLabel={`${item.title}更多操作`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onMore}
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

function OverviewContent({
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

function UploadRecordRow({ onReupload, record }: { onReupload: () => void; record: UploadRecord }) {
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

function GroupCard({
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

function ActionButton({
  icon,
  label,
  onPress,
  emphasized = false,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  emphasized?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        emphasized && styles.emphasizedActionButton,
        disabled && styles.disabledActionButton,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={colors.ink} name={icon} size={typography.body.lineHeight} />
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

function FixedActions({
  activeTab,
  onLinkGroups,
  onUpload,
  uploading,
}: {
  activeTab: DetailTab;
  onLinkGroups: () => void;
  onUpload: () => void;
  uploading: boolean;
}) {
  if (activeTab === 'groups') {
    return (
      <View style={styles.fixedActions} testID="data-source-fixed-actions">
        <ActionButton emphasized icon="add" label="关联新分组" onPress={onLinkGroups} />
      </View>
    );
  }
  if (activeTab === 'uploads') {
    return (
      <View style={styles.fixedActions} testID="data-source-fixed-actions">
        <ActionButton
          emphasized
          icon="cloud-upload-outline"
          label={uploading ? '正在上传…' : '上传音频'}
          onPress={onUpload}
          disabled={uploading}
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
        label={uploading ? '正在上传…' : '上传音频'}
        onPress={onUpload}
        disabled={uploading}
      />
    </View>
  );
}

/** 渲染数据源详情及四个可点击、可滑动的同级页面。 */
export function DataSourceDetailScreen({
  onBack,
  onArchived,
  onSwitchGroup,
  onOpenAudio,
  preferredGroupId,
  sourceId,
}: {
  onBack: () => void;
  onArchived?: () => void;
  onSwitchGroup?: (groupId: string) => void;
  onOpenAudio?: (audioFileId: string, groupId: string) => void;
  preferredGroupId?: string;
  sourceId: string;
}) {
  const [source, setSource] = useState<DataSourceDetailView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [progressRefreshError, setProgressRefreshError] = useState('');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [editVisible, setEditVisible] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [archiveSourceVisible, setArchiveSourceVisible] = useState(false);
  const [audioArchiveTarget, setAudioArchiveTarget] = useState<SourceAudioItem>();
  const [audioActionTarget, setAudioActionTarget] = useState<SourceAudioItem>();
  const [analysisGroupTarget, setAnalysisGroupTarget] = useState<SourceAudioItem>();
  const [transcriptionErrorTarget, setTranscriptionErrorTarget] = useState<SourceAudioItem>();
  const [transcriptionProgressAudioId, setTranscriptionProgressAudioId] = useState<string>();
  const [transcriptionTarget, setTranscriptionTarget] = useState<SourceAudioItem>();
  const [transcriptionCapabilities, setTranscriptionCapabilities] =
    useState<AudioTranscriptionCapabilitiesResponse>();
  const [transcriptionPreprocessing, setTranscriptionPreprocessing] =
    useState<AudioTranscriptionPreprocessing>('silero_vad');
  const [startingTranscription, setStartingTranscription] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<LinkedDataSourceGroup>();
  const [switchTarget, setSwitchTarget] = useState<LinkedDataSourceGroup>();
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [availableGroups, setAvailableGroups] = useState<GroupSummary[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(() => new Set());
  const [linking, setLinking] = useState(false);
  const audioPlayback = useAudioPlayback();
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } = useSwipePager({
    activeTab,
    onTabChange: setActiveTab,
    tabs: detailTabKeys,
  });

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError('');
      try {
        const [detail, audio, records, groups, capabilities] = await Promise.all([
          getDataSource(sourceId),
          listDataSourceAudioFiles(sourceId),
          listDataSourceIngestionRecords(sourceId),
          listDataSourceGroups(sourceId),
          showLoading
            ? getAudioTranscriptionCapabilities().catch(() => undefined)
            : Promise.resolve(undefined),
        ]);
        if (showLoading) setTranscriptionCapabilities(capabilities);
        setSource(toDataSourceDetailView(detail, audio.items, records.items, groups.items));
        if (!showLoading) setProgressRefreshError('');
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '数据源加载失败。';
        if (showLoading) {
          setSource(undefined);
          setError(message);
        } else {
          setProgressRefreshError(`进度刷新失败：${message}`);
        }
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [sourceId],
  );
  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const pollingTranscription = source?.audioItems.some(
    (item) => item.status.kind === 'transcribing',
  );
  useEffect(() => {
    if (!pollingTranscription) return undefined;
    const timer = setInterval(() => {
      void load(false);
    }, 2_000);
    return () => clearInterval(timer);
  }, [load, pollingTranscription]);

  const playAudio = (item: SourceAudioItem) => {
    setOperationError('');
    audioPlayback.toggleAudio(item.id);
  };

  const transcriptionProgressTarget = source?.audioItems.find(
    (item) => item.id === transcriptionProgressAudioId && item.status.kind === 'transcribing',
  );

  const linkedGroupIds = useMemo(
    () => new Set(source?.linkedGroups.map((group) => group.id) ?? []),
    [source?.linkedGroups],
  );

  const saveDataSource = async (value: DataSourceFormValue) => {
    setSaving(true);
    setFormError('');
    try {
      await updateDataSource(sourceId, value);
      setEditVisible(false);
      await load(false);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '数据源保存失败。');
    } finally {
      setSaving(false);
    }
  };

  const pickAndUpload = async () => {
    if (uploading) return;
    const selection = await DocumentPicker.getDocumentAsync({
      type: ['audio/*'],
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (selection.canceled) return;
    const assets = selection.assets;
    const allowedExtensions = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm']);
    if (assets.length > 20) {
      setOperationError('单批最多上传 20 个音频文件。');
      return;
    }
    if (
      assets.some(
        (asset) => !allowedExtensions.has(asset.name.split('.').pop()?.toLowerCase() ?? ''),
      )
    ) {
      setOperationError('仅支持 MP3、WAV、M4A、AAC、FLAC、OGG 和 WebM 音频。');
      return;
    }
    const totalBytes = assets.reduce((total, asset) => total + (asset.size ?? 0), 0);
    if (
      assets.some((asset) => (asset.size ?? 0) > 200 * 1024 * 1024) ||
      totalBytes > 200 * 1024 * 1024
    ) {
      setOperationError('单个文件和整批文件总大小均不能超过 200 MB。');
      return;
    }
    setUploading(true);
    setOperationError('');
    try {
      await uploadDataSourceAudioFiles(sourceId, assets);
      await load(false);
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '音频上传失败。');
    } finally {
      setUploading(false);
    }
  };

  const loadAvailableGroups = useCallback(async () => {
    setPickerLoading(true);
    setPickerError('');
    setAvailableGroups([]);
    try {
      setAvailableGroups((await listGroups()).items);
    } catch (reason) {
      setPickerError(reason instanceof Error ? reason.message : '分组加载失败。');
    } finally {
      setPickerLoading(false);
    }
  }, []);

  const openGroupPicker = () => {
    setSelectedGroupIds(new Set());
    setPickerVisible(true);
    void loadAvailableGroups();
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const confirmLinks = async () => {
    if (linking || selectedGroupIds.size === 0) return;
    setLinking(true);
    setPickerError('');
    try {
      await linkDataSourceGroups(sourceId, { groupIds: [...selectedGroupIds] });
      await load(false);
      setPickerVisible(false);
    } catch (reason) {
      setPickerError(reason instanceof Error ? reason.message : '关联分组失败。');
    } finally {
      setLinking(false);
    }
  };

  const confirmArchiveSource = async () => {
    setConfirming(true);
    setOperationError('');
    try {
      await archiveDataSource(sourceId);
      setArchiveSourceVisible(false);
      (onArchived ?? onBack)();
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '数据源归档失败。');
      setArchiveSourceVisible(false);
    } finally {
      setConfirming(false);
    }
  };

  const confirmArchiveAudio = async () => {
    const target = audioArchiveTarget;
    if (!target) return;
    setConfirming(true);
    setOperationError('');
    try {
      await archiveDataSourceAudioFile(sourceId, target.id);
      setAudioArchiveTarget(undefined);
      await load(false);
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '音频归档失败。');
    } finally {
      setConfirming(false);
    }
  };

  const confirmTranscription = async () => {
    const target = transcriptionTarget;
    if (!target || startingTranscription) return;
    setStartingTranscription(true);
    setOperationError('');
    try {
      await startAudioTranscription(target.id, {
        model: DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
        preprocessing: transcriptionPreprocessing,
        segmentationMode: 'speaker_turn',
      });
      setTranscriptionTarget(undefined);
      await load(false);
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : 'ASR 转写启动失败。');
    } finally {
      setStartingTranscription(false);
    }
  };

  const confirmUnlink = async () => {
    const target = unlinkTarget;
    if (!target) return;
    setConfirming(true);
    setOperationError('');
    try {
      await unlinkDataSourceGroup(sourceId, target.id);
      setUnlinkTarget(undefined);
      await load(false);
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '解除关联失败。');
    } finally {
      setConfirming(false);
    }
  };

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
  const prepareTranscription = (target: SourceAudioItem) => {
    setTranscriptionPreprocessing('silero_vad');
    setTranscriptionTarget(target);
  };
  const openMoreActions = () =>
    Alert.alert('数据源操作', source.name, [
      {
        text: '编辑数据源',
        onPress: () => {
          setFormError('');
          setEditVisible(true);
        },
      },
      { text: '归档数据源', onPress: () => setArchiveSourceVisible(true), style: 'destructive' },
      { text: '取消', style: 'cancel' },
    ]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <AudioTranscriptionErrorDialog
        audio={transcriptionErrorTarget}
        onClose={() => setTranscriptionErrorTarget(undefined)}
        onRetry={() => {
          const target = transcriptionErrorTarget;
          setTranscriptionErrorTarget(undefined);
          if (target) prepareTranscription(target);
        }}
      />
      <AudioTranscriptionProgressDialog
        audio={transcriptionProgressTarget}
        onClose={() => setTranscriptionProgressAudioId(undefined)}
      />
      <DataSourceAudioActions
        audio={audioActionTarget}
        onAnalysis={() => {
          const target = audioActionTarget;
          setAudioActionTarget(undefined);
          if (!target?.hasTranscript) return;
          const preferred = source.linkedGroups.find((item) => item.id === preferredGroupId);
          if (preferred) onOpenAudio?.(target.id, preferred.id);
          else if (source.linkedGroups.length === 1)
            onOpenAudio?.(target.id, source.linkedGroups[0].id);
          else if (source.linkedGroups.length > 1) setAnalysisGroupTarget(target);
          else setOperationError('当前数据源尚未关联分组，请先关联分组后再分析。');
        }}
        onArchive={() => {
          const target = audioActionTarget;
          setAudioActionTarget(undefined);
          if (target) setAudioArchiveTarget(target);
        }}
        onClose={() => setAudioActionTarget(undefined)}
        onTranscribe={() => {
          const target = audioActionTarget;
          setAudioActionTarget(undefined);
          if (target) prepareTranscription(target);
        }}
      />
      <AnalysisGroupPicker
        groups={source.linkedGroups}
        onClose={() => setAnalysisGroupTarget(undefined)}
        onSelect={(groupId) => {
          const target = analysisGroupTarget;
          setAnalysisGroupTarget(undefined);
          if (target) onOpenAudio?.(target.id, groupId);
        }}
        visible={Boolean(analysisGroupTarget)}
      />
      <DataSourceFormSheet
        error={formError}
        initialValue={{
          name: source.name,
          description: source.description,
          customBusinessRoles: source.customBusinessRoles,
        }}
        mode="edit"
        onClose={() => {
          if (!saving) setEditVisible(false);
        }}
        onSubmit={(value) => {
          void saveDataSource(value);
        }}
        pending={saving}
        transcriptionModel={source.analysisModel}
        visible={editVisible}
      />
      <DataSourceGroupPicker
        allGroups={availableGroups}
        error={pickerError}
        linkedGroupIds={linkedGroupIds}
        loading={pickerLoading}
        onClose={() => {
          if (!linking) setPickerVisible(false);
        }}
        onConfirm={() => {
          void confirmLinks();
        }}
        onRetry={() => {
          void loadAvailableGroups();
        }}
        onToggle={toggleGroup}
        pending={linking}
        selectedGroupIds={selectedGroupIds}
        visible={pickerVisible}
      />
      <DataSourceConfirmDialog
        body="归档后该数据源及其音频将从分组中隐藏，但关联、音频记录和本地文件会保留。"
        confirmLabel="确认归档"
        onCancel={() => setArchiveSourceVisible(false)}
        onConfirm={() => {
          void confirmArchiveSource();
        }}
        pending={confirming}
        title="归档数据源？"
        visible={archiveSourceVisible}
      />
      <DataSourceConfirmDialog
        body={`归档“${audioArchiveTarget?.title ?? ''}”后，它将不再出现在数据源和分组列表中。`}
        confirmLabel="归档音频"
        onCancel={() => setAudioArchiveTarget(undefined)}
        onConfirm={() => {
          void confirmArchiveAudio();
        }}
        pending={confirming}
        title="归档音频？"
        visible={Boolean(audioArchiveTarget)}
      />
      <AudioTranscriptionConfirmDialog
        audioTitle={transcriptionTarget?.title ?? ''}
        models={[...(transcriptionCapabilities?.models ?? [])]}
        onPreprocessingChange={setTranscriptionPreprocessing}
        onCancel={() => {
          if (!startingTranscription) setTranscriptionTarget(undefined);
        }}
        onConfirm={() => {
          void confirmTranscription();
        }}
        pending={startingTranscription}
        preprocessing={transcriptionPreprocessing}
        sileroVad={transcriptionCapabilities?.sileroVad}
        visible={Boolean(transcriptionTarget)}
      />
      <DataSourceConfirmDialog
        body={`解除后，“${unlinkTarget?.name ?? ''}”将不再通过此数据源看到相关音频；显式分享不受影响。`}
        confirmLabel="解除关联"
        onCancel={() => setUnlinkTarget(undefined)}
        onConfirm={() => {
          void confirmUnlink();
        }}
        pending={confirming}
        title="解除分组关联？"
        visible={Boolean(unlinkTarget)}
      />
      <DataSourceConfirmDialog
        body={`将返回主页并切换到“${switchTarget?.name ?? ''}”的连接数据源分页。`}
        confirmLabel="确认切换"
        onCancel={() => setSwitchTarget(undefined)}
        onConfirm={() => {
          const target = switchTarget;
          setSwitchTarget(undefined);
          if (target) onSwitchGroup?.(target.id);
        }}
        title="切换分组？"
        visible={Boolean(switchTarget)}
      />
      <PageHeader
        onBack={onBack}
        onMore={openMoreActions}
        onSearch={() => showComingSoon('数据源详情搜索')}
        searchLabel="搜索数据源内容"
        title={source.name}
      />
      {operationError || audioPlayback.error ? (
        <View style={styles.operationError}>
          <Text accessibilityRole="alert" style={styles.operationErrorText}>
            {audioPlayback.error
              ? `音频播放失败：${audioPlayback.error} 请再次点击播放按钮重试。`
              : operationError}
          </Text>
        </View>
      ) : null}
      {progressRefreshError ? (
        <View style={styles.refreshError}>
          <Text accessibilityRole="alert" style={styles.operationErrorText}>
            {progressRefreshError}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load(false)}
            style={styles.refreshRetryButton}
          >
            <Text style={styles.refreshRetryText}>立即重试</Text>
          </Pressable>
        </View>
      ) : null}
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
            <Text style={styles.heroDescription}>{source.description || '暂无描述'}</Text>
            <Text style={styles.heroMeta}>
              {source.connection}　接入 {source.linkedGroupCount} 个分组
            </Text>
          </View>
          {renderTabs()}
          <OverviewContent
            activeAudioFileId={audioPlayback.activeAudioFileId}
            audioLoading={!audioPlayback.isLoaded || audioPlayback.isBuffering}
            audioPlaying={audioPlayback.isPlaying}
            onOpenAudioActions={setAudioActionTarget}
            onPlayAudio={playAudio}
            onShowAudioError={setTranscriptionErrorTarget}
            onShowAudioProgress={(item) => setTranscriptionProgressAudioId(item.id)}
            source={source}
          />
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
            {source.audioItems.length === 0 ? (
              <Text style={styles.listEmptyText}>暂无音频，点击下方“上传音频”开始添加。</Text>
            ) : (
              source.audioItems.map((item) => (
                <AudioRow
                  active={audioPlayback.activeAudioFileId === item.id}
                  item={item}
                  key={item.id}
                  loading={
                    audioPlayback.activeAudioFileId === item.id &&
                    (!audioPlayback.isLoaded || audioPlayback.isBuffering)
                  }
                  onMore={() => setAudioActionTarget(item)}
                  onPlay={() => playAudio(item)}
                  onShowError={() => setTranscriptionErrorTarget(item)}
                  onShowProgress={() => setTranscriptionProgressAudioId(item.id)}
                  playing={audioPlayback.activeAudioFileId === item.id && audioPlayback.isPlaying}
                />
              ))
            )}
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
            {uploadDates.length === 0 ? (
              <Text style={styles.listEmptyText}>暂无上传记录。</Text>
            ) : (
              uploadDates.map((date, index) => (
                <View
                  key={date}
                  style={[styles.recordGroup, index > 0 && styles.recordGroupDivider]}
                >
                  <Text style={styles.recordDate}>{date}</Text>
                  {source.uploadRecords
                    .filter((record) => record.date === date)
                    .map((record) => (
                      <UploadRecordRow
                        key={record.id}
                        onReupload={() => {
                          void pickAndUpload();
                        }}
                        record={record}
                      />
                    ))}
                </View>
              ))
            )}
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
            {source.linkedGroups.length === 0 ? (
              <Text style={styles.listEmptyText}>暂未关联分组。</Text>
            ) : (
              source.linkedGroups.map((group) => (
                <GroupCard
                  group={group}
                  key={group.id}
                  onSwitch={() => setSwitchTarget(group)}
                  onUnlink={() => setUnlinkTarget(group)}
                />
              ))
            )}
          </View>
        </ScrollView>
      </ScrollView>
      <FixedActions
        activeTab={activeTab}
        onLinkGroups={openGroupPicker}
        onUpload={() => {
          void pickAndUpload();
        }}
        uploading={uploading}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  pager: { flex: 1 },
  page: { backgroundColor: colors.card, height: '100%' },
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
    minHeight: typography.body.lineHeight * 2,
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
  disabledButton: { opacity: 0.4 },
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
  processingStatus: {
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  processingTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  processingTitle: {
    ...typography.description,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
  },
  processingPercent: {
    ...typography.label,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  processingProgressTrack: {
    backgroundColor: colors.divider,
    borderRadius: radii.round,
    height: 4,
    overflow: 'hidden',
  },
  processingProgressFill: {
    backgroundColor: colors.ink,
    borderRadius: radii.round,
    height: '100%',
  },
  processingAttempts: {
    ...typography.label,
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
  disabledActionButton: { opacity: 0.5 },
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
  listEmptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  operationError: {
    backgroundColor: colors.background,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  operationErrorText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  refreshError: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  refreshRetryButton: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
  },
  refreshRetryText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
});
