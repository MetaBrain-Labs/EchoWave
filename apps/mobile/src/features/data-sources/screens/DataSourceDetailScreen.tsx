/**
 * 数据源详情页面。
 *
 * 组合数据源概览、音频文件、上传记录和关联分组四个同级页面。
 *
 * Responsibilities:
 * - 根据数据源标识读取并组合服务端只读详情。
 * - 提供跨音频、上传记录和关联分组的详情搜索。
 * - 协调标签点击、横向滑动、独立纵向滚动和固定操作栏。
 * - 为尚未接入的批量转写和记录操作提供明确反馈。
 *
 * Notes:
 * - 页面不持久化筛选、分页或操作栏交互状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type {
  AudioTranscriptionCapabilitiesResponse,
  AudioTranscriptionPreprocessing,
  AudioRuntimeMode,
  LinkedDataSourceGroup,
  SupportedLanguage,
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
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAudioPlayback } from '@/shared/audio/useAudioPlayback';
import { pickDocumentAsync } from '@/shared/files/documentPicker';
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
import { SearchSheet } from '@/shared/ui/SearchSheet';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';
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
  uploadSessionAudioFiles,
} from '@/shared/api/dataSourcesApi';
import {
  getAudioTranscriptionCapabilities,
  remountAudioSource,
  startAudioTranscription,
} from '@/shared/api/audioAnalysisApi';
import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

import {
  AudioTranscriptionConfirmDialog,
  DataSourceConfirmDialog,
  DataSourceFormSheet,
  DataSourceGroupPicker,
  LightweightUploadConfirmDialog,
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

const detailTabKeys = ['overview', 'audio', 'uploads', 'groups'] as const;
type DetailTab = (typeof detailTabKeys)[number];
type TranslationFunction = ReturnType<typeof useAppLanguage>['t'];

/** 规范化详情搜索并匹配一组可见文本。 */
function matchesDetailSearch(query: string, values: (string | number)[]) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return values.some((value) => String(value).toLocaleLowerCase().includes(normalized));
}

/** 将音频处理状态转换为当前应用语言的可搜索文本。 */
function audioStatusSearchText(item: SourceAudioItem, t: TranslationFunction) {
  switch (item.status.kind) {
    case 'complete':
      return t('sourceDetail.statusComplete');
    case 'uploading':
      return t('sourceDetail.statusUploading');
    case 'waiting':
      return t('sourceDetail.statusWaiting');
    case 'transcribing':
      return t('sourceDetail.statusTranscribing');
    case 'upload-failed':
      return `${t('sourceDetail.statusUploadFailed')} ${item.status.code} ${item.status.message}`;
    case 'transcription-failed':
      return `${t('sourceDetail.statusTranscriptionFailed')} ${item.status.code} ${item.status.message}`;
  }
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
  const { formatNumber, language: appLanguage, t } = useAppLanguage();
  const detailTabs = [
    { key: 'overview', label: t('sourceDetail.tabOverview') },
    { key: 'audio', label: t('sourceDetail.tabAudio') },
    { key: 'uploads', label: t('sourceDetail.tabUploads') },
    { key: 'groups', label: t('sourceDetail.tabGroups') },
  ] as const;
  const [source, setSource] = useState<DataSourceDetailView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [progressRefreshError, setProgressRefreshError] = useState('');
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
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
  const [includeAcousticEmotion, setIncludeAcousticEmotion] = useState(true);
  const [audioRuntimeMode, setAudioRuntimeMode] = useState<AudioRuntimeMode>('hybrid');
  const [expectedSpeakerCount, setExpectedSpeakerCount] = useState('');
  const [analysisLanguage, setAnalysisLanguage] = useState<SupportedLanguage>(appLanguage);
  const [startingTranscription, setStartingTranscription] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<LinkedDataSourceGroup>();
  const [switchTarget, setSwitchTarget] = useState<LinkedDataSourceGroup>();
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingUploadAssets, setPendingUploadAssets] =
    useState<DocumentPicker.DocumentPickerAsset[]>();
  const [uploadIncludeAcousticEmotion, setUploadIncludeAcousticEmotion] = useState(true);
  const audioPlayback = useAudioPlayback();
  const runInitialRequest = useInitialRequestLoading();
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
        const [detail, audio, records, groups, capabilities, runtime] = await Promise.all([
          getDataSource(sourceId),
          listDataSourceAudioFiles(sourceId),
          listDataSourceIngestionRecords(sourceId),
          listDataSourceGroups(sourceId),
          showLoading
            ? getAudioTranscriptionCapabilities().catch(() => undefined)
            : Promise.resolve(undefined),
          showLoading ? getAudioRuntime().catch(() => undefined) : Promise.resolve(undefined),
        ]);
        if (showLoading) setTranscriptionCapabilities(capabilities);
        if (runtime) setAudioRuntimeMode(runtime.mode);
        setSource(
          toDataSourceDetailView(detail, audio.items, records.items, groups.items, appLanguage),
        );
        if (!showLoading) setProgressRefreshError('');
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : t('sources.loadFailed');
        if (showLoading) {
          setSource(undefined);
          setError(message);
        } else {
          setProgressRefreshError(t('sourceDetail.progressRefreshFailed', { message }));
        }
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [appLanguage, sourceId, t],
  );
  useEffect(() => {
    const task = setTimeout(() => void runInitialRequest(load), 0);
    return () => clearTimeout(task);
  }, [load, runInitialRequest]);

  const refreshPage = useCallback(async () => {
    try {
      await Promise.all([
        load(false),
        getAudioTranscriptionCapabilities().then(setTranscriptionCapabilities),
        getAudioRuntime().then((runtime) => setAudioRuntimeMode(runtime.mode)),
      ]);
    } catch (reason) {
      setProgressRefreshError(
        reason instanceof Error ? reason.message : t('sourceDetail.refreshFailed'),
      );
      throw reason;
    }
  }, [load, t]);
  const screenRefresh = useScreenRefresh(refreshPage);

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
    language: appLanguage,
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
      setFormError(reason instanceof Error ? reason.message : t('sourceDetail.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const performUpload = async (
    assets: DocumentPicker.DocumentPickerAsset[],
    includeEmotion = true,
  ) => {
    setUploading(true);
    setOperationError('');
    try {
      // 兼容旧版测试适配器；正式 API 始终提供流式会话实现。
      if (audioRuntimeMode === 'hybrid' && typeof uploadSessionAudioFiles !== 'function') {
        await uploadDataSourceAudioFiles(sourceId, assets);
      } else {
        await uploadSessionAudioFiles(sourceId, assets, audioRuntimeMode, includeEmotion);
      }
      setPendingUploadAssets(undefined);
      await load(false);
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : t('sourceDetail.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const pickAndUpload = async () => {
    if (uploading) return;
    try {
      const selection = await pickDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (!selection || selection.canceled) return;
      const assets = selection.assets;
      const allowedExtensions = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm']);
      if (assets.length > 20) {
        setOperationError(t('sourceDetail.batchLimit'));
        return;
      }
      if (
        assets.some(
          (asset) => !allowedExtensions.has(asset.name.split('.').pop()?.toLowerCase() ?? ''),
        )
      ) {
        setOperationError(t('sourceDetail.formatLimit'));
        return;
      }
      const totalBytes = assets.reduce((total, asset) => total + (asset.size ?? 0), 0);
      if (
        assets.some((asset) => (asset.size ?? 0) > 200 * 1024 * 1024) ||
        totalBytes > 200 * 1024 * 1024
      ) {
        setOperationError(t('sourceDetail.sizeLimit'));
        return;
      }
      if (audioRuntimeMode === 'lightweight_local') {
        setUploadIncludeAcousticEmotion(true);
        setPendingUploadAssets(assets);
        return;
      }
      await performUpload(assets, false);
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : t('sourceDetail.uploadFailed'));
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
      setOperationError(reason instanceof Error ? reason.message : t('sourceDetail.archiveFailed'));
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
      setOperationError(
        reason instanceof Error ? reason.message : t('sourceDetail.archiveAudioFailed'),
      );
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
      if (target.sourceRecoveryState === 'required') {
        const selection = await pickDocumentAsync({
          type: ['audio/*'],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (!selection || selection.canceled) return;
        await remountAudioSource(target.id, selection.assets[0]!);
      }
      await startAudioTranscription(target.id, {
        model: DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
        includeAcousticEmotion,
        preprocessing: transcriptionPreprocessing,
        segmentationMode: 'speaker_turn',
        language: analysisLanguage,
        ...(expectedSpeakerCount ? { expectedSpeakerCount: Number(expectedSpeakerCount) } : {}),
      });
      setTranscriptionTarget(undefined);
      await load(false);
    } catch (reason) {
      setOperationError(
        reason instanceof Error ? reason.message : t('sourceDetail.startAsrFailed'),
      );
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
      setOperationError(reason instanceof Error ? reason.message : t('sourceDetail.unlinkFailed'));
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <PageHeader
          onBack={onBack}
          onMore={() => showComingSoon(t('common.moreActions'))}
          title={t('sourceDetail.title')}
        />
        <ActivityIndicator
          accessibilityLabel={t('sourceDetail.loading')}
          color={colors.ink}
          style={styles.loading}
        />
      </SafeAreaView>
    );
  }

  if (!source) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <PageHeader
          onBack={onBack}
          onMore={() => showComingSoon(t('common.moreActions'))}
          title={t('sourceDetail.title')}
        />
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.emptyState}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        >
          <Ionicons color={colors.secondary} name="git-network-outline" size={40} />
          <Text style={styles.emptyTitle}>
            {error.includes('不存在') ? t('sourceDetail.notFound') : t('common.loadFailed')}
          </Text>
          <Text accessibilityRole="alert" style={styles.emptyDescription}>
            {error || t('sourceDetail.removed')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>{t('sources.reload')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const renderTabs = () => (
    <View style={styles.tabsSurface}>
      <PageTabs
        activeTab={activeTab}
        onChange={selectTab}
        tabs={detailTabs}
        testIDPrefix="data-source-tab"
      />
    </View>
  );
  const filteredAudioItems = source.audioItems.filter((item) =>
    matchesDetailSearch(searchQuery, [
      item.title,
      item.duration,
      item.createdAt,
      audioStatusSearchText(item, t),
    ]),
  );
  const filteredUploadRecords = source.uploadRecords.filter((record) =>
    matchesDetailSearch(searchQuery, [
      record.date,
      record.time,
      record.kind === 'upload-success'
        ? t('sourceDetail.uploadSuccess')
        : record.kind === 'upload-failed'
          ? t('sourceDetail.statusUploadFailed')
          : t('sourceDetail.statusTranscriptionFailed'),
      record.description,
      record.detail,
    ]),
  );
  const filteredGroups = source.linkedGroups.filter((group) =>
    matchesDetailSearch(searchQuery, [group.name]),
  );
  const uploadDates = [...new Set(filteredUploadRecords.map((record) => record.date))];
  const prepareTranscription = (target: SourceAudioItem) => {
    setTranscriptionPreprocessing('silero_vad');
    setExpectedSpeakerCount('');
    setIncludeAcousticEmotion(true);
    setAnalysisLanguage(appLanguage);
    setTranscriptionTarget(target);
  };

  const requestTranscription = () => {
    if (audioRuntimeMode !== 'lightweight_local' || includeAcousticEmotion) {
      void confirmTranscription();
      return;
    }
    Alert.alert(t('sourceDetail.disableEmotion'), t('sourceDetail.disableEmotionBody'), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('sourceDetail.disableAnyway'),
        style: 'destructive',
        onPress: () => void confirmTranscription(),
      },
    ]);
  };
  const requestLightweightUpload = () => {
    const assets = pendingUploadAssets;
    if (!assets) return;
    if (uploadIncludeAcousticEmotion) {
      void performUpload(assets, true);
      return;
    }
    Alert.alert(t('sourceDetail.disableEmotion'), t('sourceDetail.disableEmotionBatchBody'), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('sourceDetail.disableAnyway'),
        style: 'destructive',
        onPress: () => void performUpload(assets, false),
      },
    ]);
  };
  const openMoreActions = () =>
    Alert.alert(t('sourceDetail.actions'), source.name, [
      {
        text: t('sourceDetail.edit'),
        onPress: () => {
          setFormError('');
          setEditVisible(true);
        },
      },
      {
        text: t('sourceDetail.archive'),
        onPress: () => setArchiveSourceVisible(true),
        style: 'destructive',
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      {searchVisible ? (
        <SearchSheet
          appliedQuery={searchQuery}
          inputLabel={t('sourceDetail.searchInput')}
          onApply={(nextQuery) => {
            setSearchQuery(nextQuery);
            setSearchVisible(false);
            if (nextQuery && activeTab === 'overview') selectTab('audio');
          }}
          onClose={() => setSearchVisible(false)}
          placeholder={t('sourceDetail.searchPlaceholder')}
          subtitle={t('sourceDetail.searchSubtitle')}
          title={t('sourceDetail.searchTitle')}
          visible
        />
      ) : null}
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
          else setOperationError(t('sourceDetail.noGroupForAnalysis'));
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
        body={t('sourceDetail.archiveBody')}
        confirmLabel={t('sourceDetail.confirmArchive')}
        onCancel={() => setArchiveSourceVisible(false)}
        onConfirm={() => {
          void confirmArchiveSource();
        }}
        pending={confirming}
        title={t('sourceDetail.archiveTitle')}
        visible={archiveSourceVisible}
      />
      <DataSourceConfirmDialog
        body={t('sourceDetail.archiveAudioBody', { title: audioArchiveTarget?.title ?? '' })}
        confirmLabel={t('sourceDetail.archiveAudio')}
        onCancel={() => setAudioArchiveTarget(undefined)}
        onConfirm={() => {
          void confirmArchiveAudio();
        }}
        pending={confirming}
        title={t('sourceDetail.archiveAudioTitle')}
        visible={Boolean(audioArchiveTarget)}
      />
      <AudioTranscriptionConfirmDialog
        audioTitle={transcriptionTarget?.title ?? ''}
        expectedSpeakerCount={expectedSpeakerCount}
        includeAcousticEmotion={includeAcousticEmotion}
        models={[...(transcriptionCapabilities?.models ?? [])]}
        onPreprocessingChange={setTranscriptionPreprocessing}
        onCancel={() => {
          if (!startingTranscription) setTranscriptionTarget(undefined);
        }}
        onConfirm={requestTranscription}
        onExpectedSpeakerCountChange={setExpectedSpeakerCount}
        onIncludeAcousticEmotionChange={setIncludeAcousticEmotion}
        pending={startingTranscription}
        preprocessing={transcriptionPreprocessing}
        sileroVad={transcriptionCapabilities?.sileroVad}
        showAcousticEmotionOption={audioRuntimeMode === 'lightweight_local'}
        visible={Boolean(transcriptionTarget)}
        language={analysisLanguage}
        onLanguageChange={setAnalysisLanguage}
      />
      <LightweightUploadConfirmDialog
        includeAcousticEmotion={uploadIncludeAcousticEmotion}
        onCancel={() => {
          if (!uploading) setPendingUploadAssets(undefined);
        }}
        onChange={setUploadIncludeAcousticEmotion}
        onConfirm={requestLightweightUpload}
        pending={uploading}
        visible={Boolean(pendingUploadAssets)}
      />
      <DataSourceConfirmDialog
        body={t('sourceDetail.unlinkBody', { name: unlinkTarget?.name ?? '' })}
        confirmLabel={t('sourceDetail.unlink')}
        onCancel={() => setUnlinkTarget(undefined)}
        onConfirm={() => {
          void confirmUnlink();
        }}
        pending={confirming}
        title={t('sourceDetail.unlinkTitle')}
        visible={Boolean(unlinkTarget)}
      />
      <DataSourceConfirmDialog
        body={t('sourceDetail.switchBody', { name: switchTarget?.name ?? '' })}
        confirmLabel={t('sourceDetail.confirmSwitch')}
        onCancel={() => setSwitchTarget(undefined)}
        onConfirm={() => {
          const target = switchTarget;
          setSwitchTarget(undefined);
          if (target) onSwitchGroup?.(target.id);
        }}
        title={t('sourceDetail.switchTitle')}
        visible={Boolean(switchTarget)}
      />
      <PageHeader
        onBack={onBack}
        onMore={openMoreActions}
        onSearch={() => setSearchVisible(true)}
        searchLabel={t('sourceDetail.searchTitle')}
        title={source.name}
      />
      {operationError || audioPlayback.error ? (
        <View style={styles.operationError}>
          <Text accessibilityRole="alert" style={styles.operationErrorText}>
            {audioPlayback.error
              ? t('sourceDetail.playbackFailed', { message: audioPlayback.error })
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
            <Text style={styles.refreshRetryText}>{t('sourceDetail.retryNow')}</Text>
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
          alwaysBounceVertical
          contentContainerStyle={styles.pageContent}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[1]}
          style={[styles.page, { width: pageWidth }]}
          testID="data-source-overview-scroll"
        >
          <View style={styles.hero}>
            <Text accessibilityRole="header" style={styles.heroTitle}>
              {source.name}
            </Text>
            <Text style={styles.heroDescription}>
              {source.description || t('sources.noDescription')}
            </Text>
            <Text style={styles.heroMeta}>
              {t('sourceDetail.meta', {
                connection: source.connection,
                count: formatNumber(source.linkedGroupCount),
              })}
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
          alwaysBounceVertical
          contentContainerStyle={styles.pageContent}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
          style={[styles.page, { width: pageWidth }]}
          testID="data-source-audio-scroll"
        >
          {renderTabs()}
          <View style={styles.audioList}>
            {filteredAudioItems.length === 0 ? (
              <Text style={styles.listEmptyText}>
                {searchQuery
                  ? t('sourceDetail.noAudioMatch', { query: searchQuery })
                  : t('sourceDetail.noAudio')}
              </Text>
            ) : (
              filteredAudioItems.map((item) => (
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
          alwaysBounceVertical
          contentContainerStyle={styles.pageContent}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
          style={[styles.page, { width: pageWidth }]}
          testID="data-source-uploads-scroll"
        >
          {renderTabs()}
          <View style={styles.recordsList}>
            {uploadDates.length === 0 ? (
              <Text style={styles.listEmptyText}>
                {searchQuery
                  ? t('sourceDetail.noUploadMatch', { query: searchQuery })
                  : t('sourceDetail.noUploads')}
              </Text>
            ) : (
              uploadDates.map((date, index) => (
                <View
                  key={date}
                  style={[styles.recordGroup, index > 0 && styles.recordGroupDivider]}
                >
                  <Text style={styles.recordDate}>{date}</Text>
                  {filteredUploadRecords
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
          alwaysBounceVertical
          contentContainerStyle={styles.pageContent}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
          style={[styles.page, { width: pageWidth }]}
          testID="data-source-groups-scroll"
        >
          {renderTabs()}
          <View style={styles.groupList}>
            {filteredGroups.length === 0 ? (
              <Text style={styles.listEmptyText}>
                {searchQuery
                  ? t('sourceDetail.noGroupMatch', { query: searchQuery })
                  : t('sourceDetail.noGroups')}
              </Text>
            ) : (
              filteredGroups.map((group) => (
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
