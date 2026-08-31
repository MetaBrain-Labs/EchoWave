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
  LinkedDataSourceGroup,
} from '@echowave/contracts';
import { DEFAULT_AUDIO_TRANSCRIPTION_MODEL } from '@echowave/contracts';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSwipePager } from '@/shared/hooks/useSwipePager';
import { useGroupAssociationEditor } from '@/shared/hooks/useGroupAssociationEditor';
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
  archiveDataSource,
  archiveDataSourceAudioFile,
  linkDataSourceGroups,
  listDataSourceAudioFiles,
  listDataSourceGroups,
  listDataSourceIngestionRecords,
  unlinkDataSourceGroup,
  updateDataSource,
  uploadDataSourceAudioFiles,
} from '@/shared/api/dataSourcesApi';
import {
  getAudioTranscriptionCapabilities,
  startAudioTranscription,
} from '@/shared/api/audioAnalysisApi';

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
import { AudioTranscriptionProgressDialog } from '../components/AudioTranscriptionProgressDialog';
import { useDataSourceAudioUpdates } from '../hooks/useDataSourceAudioUpdates';

import { toDataSourceDetailView, type DataSourceDetailView, type SourceAudioItem } from '../model';

import { AudioRow } from '../components/DataSourceAudioRow';
import { FixedActions, showComingSoon } from '../components/DataSourceFixedActions';
import { GroupCard } from '../components/DataSourceGroupCard';
import { OverviewContent } from '../components/DataSourceOverviewContent';
import { UploadRecordRow } from '../components/DataSourceUploadRecordRow';

const detailTabs = [
  { key: 'overview', label: '概览' },
  { key: 'audio', label: '音频文件' },
  { key: 'uploads', label: '上传记录' },
  { key: 'groups', label: '关联分组' },
] as const;
type DetailTab = (typeof detailTabs)[number]['key'];
const detailTabKeys = detailTabs.map((tab) => tab.key);

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
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
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

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const hasActiveTranscription = source?.audioItems.some(
    (item) => item.status.kind === 'transcribing',
  );
  useDataSourceAudioUpdates({
    active: appActive,
    dataSourceId: sourceId,
    hasActiveTranscription: Boolean(hasActiveTranscription),
    load,
    setProgressRefreshError,
    setSource,
  });

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

  const linkSelectedGroups = useCallback(
    async (groupIds: string[]) => {
      await linkDataSourceGroups(sourceId, { groupIds });
      await load(false);
    },
    [load, sourceId],
  );
  const {
    availableGroups,
    confirmLinks,
    linking,
    loadAvailableGroups,
    openGroupPicker,
    pickerError,
    pickerLoading,
    pickerVisible,
    selectedGroupIds,
    setPickerVisible,
    toggleGroup,
  } = useGroupAssociationEditor({ linkGroups: linkSelectedGroups });

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
  loading: { marginTop: spacing.xxl },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
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
  tabsSurface: {
    backgroundColor: colors.card,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
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
  pager: { flex: 1 },
  pageContent: { paddingBottom: spacing.lg },
  page: { backgroundColor: colors.card, height: '100%' },
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
  audioList: { paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  listEmptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  recordsList: { paddingHorizontal: spacing.md },
  recordGroup: { paddingBottom: spacing.md, paddingTop: spacing.lg },
  recordGroupDivider: { borderTopColor: colors.divider, borderTopWidth: 1 },
  recordDate: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginBottom: spacing.md,
  },
  groupList: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.lg },
});
