/**
 * 一键式音频分析批次创建页。
 *
 * 提供分析对象、音频输入、可选高级设置和配置摘要，提交后进入批次详情观察服务端全流程。
 *
 * Responsibilities:
 * - 在客户端提前提示轻量本地定时不兼容和二十项批次上限。
 * - 协调文件选择、已有音频选择与批次 API。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type {
  AudioAnalysisBatch,
  AudioFileSummary,
  DataSourceSummary,
  LinkedDataSourceGroup,
  SupportedLanguage,
} from '@echowave/contracts';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  createExistingAudioAnalysisBatch,
  createUploadAnalysisBatch,
  listAudioAnalysisBatches,
} from '@/shared/api/audioAutomationApi';
import {
  listDataSourceAudioFiles,
  listDataSourceGroups,
  listDataSources,
} from '@/shared/api/dataSourcesApi';
import { getGroupSettings } from '@/shared/api/groupsApi';
import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';
import { pickDocumentAsync } from '@/shared/files/documentPicker';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';
import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';
import { ActionSheet, type ActionSheetItem } from '@/shared/ui/ActionSheet';
import { AnalysisLanguagePicker } from '@/shared/i18n/AnalysisLanguagePicker';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  pipelineForPreference,
  useAnalysisPreference,
} from '@/shared/settings/AnalysisPreferenceProvider';
import type { TranslationKey } from '@/shared/i18n/translations';

/** 渲染独立的一键分析表单，并由路由层决定是否显示返回操作。 */
export function AnalysisBatchCreateScreen({ onBack }: { onBack?: () => void }) {
  const router = useRouter();
  const { preference, hydrated } = useAnalysisPreference();
  const pipeline = pipelineForPreference(preference);
  const { language: appLanguage, formatDateTime, t } = useAppLanguage();
  const scrollRef = useRef<ScrollView>(null);
  const prepareAudioTourTarget = useCallback(() => {
    scrollRef.current?.scrollTo({ animated: true, y: 180 });
  }, []);
  const sourceTourRef = useStarterTourTarget('create-source');
  const groupTourRef = useStarterTourTarget('create-group');
  const audioTourRef = useStarterTourTarget('create-audio', prepareAudioTourTarget);
  const [sources, setSources] = useState<DataSourceSummary[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [groups, setGroups] = useState<LinkedDataSourceGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [audioFiles, setAudioFiles] = useState<AudioFileSummary[]>([]);
  const [selectedAudioIds, setSelectedAudioIds] = useState<string[]>([]);
  const [assets, setAssets] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [sourceKind, setSourceKind] = useState<'uploads' | 'existing_audio'>('uploads');
  const [analysisLanguage, setAnalysisLanguage] = useState<SupportedLanguage>(appLanguage);
  const [scheduled, setScheduled] = useState(false);
  const [scheduledText, setScheduledText] = useState('');
  const [runtimeMode, setRuntimeMode] = useState('');
  const [preview, setPreview] = useState(() => t('analysisBatch.previewEmpty'));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [recentBatches, setRecentBatches] = useState<AudioAnalysisBatch[]>([]);
  const [refreshError, setRefreshError] = useState('');
  const [sourceSheetVisible, setSourceSheetVisible] = useState(false);
  const [groupSheetVisible, setGroupSheetVisible] = useState(false);
  const [backgroundDetailsVisible, setBackgroundDetailsVisible] = useState(false);
  const [moreSettingsExpanded, setMoreSettingsExpanded] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  useEffect(() => {
    void Promise.all([listDataSources(), getAudioRuntime(), listAudioAnalysisBatches()])
      .then(([sourceResponse, runtime, batches]) => {
        setSources(sourceResponse.items);
        setSourceId(sourceResponse.items[0]?.id ?? '');
        setRuntimeMode(runtime.mode);
        setRecentBatches(batches.items);
      })
      .catch((error) =>
        Alert.alert(
          t('analysisBatch.loadFailed'),
          error instanceof Error ? error.message : t('analysisBatch.tryAgain'),
        ),
      )
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    if (!sourceId) return;
    void Promise.all([listDataSourceGroups(sourceId), listDataSourceAudioFiles(sourceId)])
      .then(([groupResponse, audioResponse]) => {
        setGroups(groupResponse.items);
        setGroupId(groupResponse.items[0]?.id ?? '');
        setAudioFiles(audioResponse.items);
      })
      .catch((error) =>
        Alert.alert(
          t('analysisBatch.loadFailed'),
          error instanceof Error ? error.message : t('analysisBatch.tryAgain'),
        ),
      );
  }, [sourceId, t]);

  useEffect(() => {
    if (!groupId) return;
    void getGroupSettings(groupId)
      .then((settings) =>
        setPreview(
          t('analysisBatch.preview', {
            focus: settings.analysis.contentFocus,
            tone: settings.analysis.tone,
            tags:
              settings.analysis.customTags.join(appLanguage === 'en' ? ', ' : '、') ||
              t('analysisBatch.none'),
          }),
        ),
      )
      .catch(() => setPreview(t('analysisBatch.previewUnavailable')));
  }, [appLanguage, groupId, t]);

  const refreshPage = useCallback(async () => {
    try {
      const [sourceResponse, runtime, batches] = await Promise.all([
        listDataSources(),
        getAudioRuntime(),
        listAudioAnalysisBatches(),
      ]);
      const nextSourceId = sourceResponse.items.some((item) => item.id === sourceId)
        ? sourceId
        : (sourceResponse.items[0]?.id ?? '');
      setSources(sourceResponse.items);
      setSourceId(nextSourceId);
      setRuntimeMode(runtime.mode);
      setRecentBatches(batches.items);

      if (!nextSourceId) {
        setGroups([]);
        setGroupId('');
        setAudioFiles([]);
        setSelectedAudioIds([]);
        setPreview(t('analysisBatch.previewEmpty'));
        setRefreshError('');
        return;
      }

      const [groupResponse, audioResponse] = await Promise.all([
        listDataSourceGroups(nextSourceId),
        listDataSourceAudioFiles(nextSourceId),
      ]);
      const nextGroupId = groupResponse.items.some((item) => item.id === groupId)
        ? groupId
        : (groupResponse.items[0]?.id ?? '');
      setGroups(groupResponse.items);
      setGroupId(nextGroupId);
      setAudioFiles(audioResponse.items);
      setSelectedAudioIds((current) =>
        current.filter((id) => {
          const audio = audioResponse.items.find((item) => item.id === id);
          return audio
            ? existingAudioDisabledReason(audio, runtime.mode, t, pipeline.includeEmotion) === null
            : false;
        }),
      );
      if (nextGroupId) {
        const settings = await getGroupSettings(nextGroupId);
        setPreview(
          t('analysisBatch.preview', {
            focus: settings.analysis.contentFocus,
            tone: settings.analysis.tone,
            tags:
              settings.analysis.customTags.join(appLanguage === 'en' ? ', ' : '、') ||
              t('analysisBatch.none'),
          }),
        );
      } else {
        setPreview(t('analysisBatch.previewEmpty'));
      }
      setRefreshError('');
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : t('analysisBatch.tryAgain'));
    }
  }, [appLanguage, groupId, sourceId, t, pipeline.includeEmotion]);
  const screenRefresh = useScreenRefresh(refreshPage);

  const selectedCount = sourceKind === 'uploads' ? assets.length : selectedAudioIds.length;
  const incompatibility = useMemo(
    () =>
      scheduled && runtimeMode === 'lightweight_local'
        ? t('analysisBatch.lightweightSchedule')
        : null,
    [runtimeMode, scheduled, t],
  );
  const selectSource = useCallback(
    (id: string) => {
      setSourceId(id);
      setGroupId('');
      setSelectedAudioIds([]);
      setPreview(t('analysisBatch.previewEmpty'));
    },
    [t],
  );
  const selectedSource = sources.find((item) => item.id === sourceId);
  const selectedGroup = groups.find((item) => item.id === groupId);
  const sourceSheetItems = useMemo<ActionSheetItem[]>(
    () =>
      sources.map((item) => ({
        id: item.id,
        icon: (item.id === sourceId
          ? 'checkmark-circle'
          : 'ellipse-outline') as keyof typeof Ionicons.glyphMap,
        label: item.name,
        onPress: () => selectSource(item.id),
      })),
    [selectSource, sourceId, sources],
  );
  const groupSheetItems = useMemo<ActionSheetItem[]>(
    () =>
      groups.map((item) => ({
        id: item.id,
        icon: (item.id === groupId
          ? 'checkmark-circle'
          : 'ellipse-outline') as keyof typeof Ionicons.glyphMap,
        label: item.name,
        onPress: () => setGroupId(item.id),
      })),
    [groupId, groups],
  );
  const ctaDisabled =
    submitting ||
    !hydrated ||
    !sourceId ||
    !groupId ||
    selectedCount < 1 ||
    selectedCount > 20 ||
    Boolean(incompatibility);

  /** 将文件大小转换为适合录入卡片的简短元数据。 */
  function formatAssetSize(size?: number) {
    if (!size || size < 1) return '';
    if (size < 1024 * 1024) return `${Math.max(0.1, size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** 将批次计数映射为用户可读的最近分析状态。 */
  function recentBatchStatus(batch: AudioAnalysisBatch) {
    if (batch.counts.active > 0 || batch.counts.blocked > 0) {
      return t('analysisBatch.recentRunning');
    }
    if (batch.counts.failed > 0 && batch.counts.completed === 0) {
      return t('analysisBatch.recentFailed');
    }
    if (batch.counts.partial > 0 || batch.counts.failed > 0) {
      return t('analysisBatch.recentPartial');
    }
    return t('analysisBatch.recentCompleted');
  }

  async function pickFiles() {
    try {
      const result = await pickDocumentAsync({
        type: 'audio/*',
        multiple: true,
        copyToCacheDirectory: false,
      });
      if (result && !result.canceled) {
        setAssets((current) => {
          const existingUris = new Set(current.map((asset) => asset.uri));
          const additions = result.assets.filter((asset) => !existingUris.has(asset.uri));
          return [...current, ...additions].slice(0, 20);
        });
      }
    } catch (error) {
      Alert.alert('选择音频失败', error instanceof Error ? error.message : '请稍后重试。');
    }
  }

  function scheduledFor(): string | null {
    if (!scheduled) return null;
    const date = new Date(scheduledText.trim().replace(' ', 'T'));
    if (!scheduledText.trim() || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      throw new Error(t('analysisBatch.invalidSchedule'));
    }
    return date.toISOString();
  }

  async function submit() {
    if (!sourceId || !groupId || selectedCount < 1 || selectedCount > 20 || incompatibility) {
      Alert.alert(
        t('analysisBatch.unableCreate'),
        incompatibility ?? t('analysisBatch.invalidSelection'),
      );
      return;
    }

    let plannedFor: string | null;
    try {
      plannedFor = scheduledFor();
    } catch (error) {
      Alert.alert(
        t('analysisBatch.unableCreate'),
        error instanceof Error ? error.message : t('analysisBatch.tryAgain'),
      );
      return;
    }

    Alert.alert(
      t('analysisBatch.backgroundConfirmTitle'),
      t('analysisBatch.backgroundConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('analysisBatch.backgroundConfirmContinue'),
          onPress: () => void startSubmission(plannedFor),
        },
      ],
    );
  }

  async function startSubmission(plannedFor: string | null) {
    setSubmitting(true);
    try {
      const common = {
        dataSourceId: sourceId,
        groupId,
        language: analysisLanguage,
        scheduledFor: plannedFor,
        pipeline,
      };
      const batch =
        sourceKind === 'uploads'
          ? await createUploadAnalysisBatch(common, assets)
          : (
              await createExistingAudioAnalysisBatch({
                ...common,
                source: 'existing_audio',
                audioFileIds: selectedAudioIds,
              })
            ).batch;
      router.push({
        pathname: '/analysis-batches/[id]',
        params: { id: batch.id },
      } as unknown as Href);
    } catch (error) {
      Alert.alert(
        t('analysisBatch.createFailed'),
        error instanceof Error ? error.message : t('analysisBatch.tryAgain'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading)
    return (
      <SafeAreaView style={styles.page}>
        <TopLevelPageHeader
          onBack={onBack}
          subtitle={t('analysisBatch.subtitle')}
          title={t('analysisBatch.title')}
        />
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.page}>
      <TopLevelPageHeader
        onBack={onBack}
        subtitle={t('analysisBatch.subtitle')}
        title={t('analysisBatch.title')}
      />
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ref={scrollRef}
        refreshControl={<ScreenRefreshControl {...screenRefresh} />}
      >
        {refreshError ? (
          <Text accessibilityRole="alert" style={styles.danger}>
            {t('analysisBatch.refreshFailed', { message: refreshError })}
          </Text>
        ) : null}
        <View collapsable={false} ref={sourceTourRef} style={styles.section}>
          <Text style={styles.sectionTitle}>{t('analysisBatch.objectSection')}</Text>
          <Text style={styles.contextLabel}>{t('analysisBatch.sourceLabel')}</Text>
          <Pressable
            accessibilityLabel={t('analysisBatch.selectSource')}
            accessibilityRole="button"
            onPress={() => setSourceSheetVisible(true)}
            style={({ pressed }) => [styles.contextRow, pressed && styles.choicePressed]}
          >
            <View style={styles.contextCopy}>
              <Text numberOfLines={1} style={styles.contextValue}>
                {selectedSource?.name ?? t('analysisBatch.noSource')}
              </Text>
              <Text style={styles.hint}>
                {sourceId ? t('analysisBatch.currentSource') : t('analysisBatch.noSource')}
              </Text>
            </View>
            <View style={styles.contextAction}>
              <Text style={styles.hint}>{t('analysisBatch.changeSource')}</Text>
              <Ionicons color={colors.secondary} name="chevron-forward" size={20} />
            </View>
          </Pressable>
          <View style={styles.separator} />
          <View collapsable={false} ref={groupTourRef} style={styles.contextHeadingRow}>
            <View>
              <Text style={styles.contextLabel}>{t('analysisBatch.groupLabel')}</Text>
              <Text style={styles.hint}>{t('analysisBatch.groupHelper')}</Text>
            </View>
            <Text style={styles.required}>{t('analysisBatch.required')}</Text>
          </View>
          <Pressable
            accessibilityLabel={t('analysisBatch.selectGroup')}
            accessibilityRole="button"
            disabled={!groups.length}
            onPress={() => setGroupSheetVisible(true)}
            style={({ pressed }) => [styles.contextRow, pressed && styles.choicePressed]}
          >
            <View style={styles.contextCopy}>
              <Text numberOfLines={1} style={styles.contextValue}>
                {selectedGroup?.name ?? t('analysisBatch.noGroups')}
              </Text>
              <Text style={styles.hint}>
                {groupId ? t('analysisBatch.currentGroup') : t('analysisBatch.chooseGroup')}
              </Text>
            </View>
            <View style={styles.contextAction}>
              <Text style={styles.hint}>{t('analysisBatch.changeGroup')}</Text>
              <Ionicons color={colors.secondary} name="chevron-forward" size={20} />
            </View>
          </Pressable>
        </View>
        <View collapsable={false} ref={audioTourRef}>
          <View style={styles.section}>
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionTitle}>{t('analysisBatch.audioSection')}</Text>
              <Text style={styles.hint}>
                {t('analysisBatch.selectedAudioCount', { count: selectedCount })}
              </Text>
            </View>
            <View accessibilityRole="tablist" style={styles.segmentedControl}>
              {(['uploads', 'existing_audio'] as const).map((kind) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: sourceKind === kind }}
                  key={kind}
                  onPress={() => setSourceKind(kind)}
                  style={[styles.segment, sourceKind === kind && styles.segmentSelected]}
                >
                  <Text
                    style={[styles.segmentText, sourceKind === kind && styles.segmentTextSelected]}
                  >
                    {t(kind === 'uploads' ? 'analysisBatch.uploads' : 'analysisBatch.existing')}
                  </Text>
                </Pressable>
              ))}
            </View>
            {sourceKind === 'uploads' ? (
              <View style={styles.audioInput}>
                {assets.length ? (
                  <View style={styles.assetList}>
                    {assets.map((asset, index) => (
                      <View key={`${asset.uri}-${index}`} style={styles.assetRow}>
                        <Ionicons color={colors.secondary} name="musical-notes-outline" size={20} />
                        <View style={styles.assetCopy}>
                          <Text numberOfLines={1} style={styles.assetName}>
                            {asset.name}
                          </Text>
                          <Text style={styles.hint}>
                            {formatAssetSize(asset.size) || t('analysisBatch.audioFile')}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityLabel={t('analysisBatch.removeAudio', { name: asset.name })}
                          accessibilityRole="button"
                          hitSlop={8}
                          onPress={() =>
                            setAssets((current) => current.filter((_, item) => item !== index))
                          }
                        >
                          <Ionicons color={colors.secondary} name="close" size={20} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={assets.length >= 20}
                  onPress={() => void pickFiles()}
                  style={({ pressed }) => [
                    styles.addAudioButton,
                    pressed && styles.choicePressed,
                    assets.length >= 20 && styles.disabled,
                  ]}
                >
                  <Ionicons color={colors.ink} name="cloud-upload-outline" size={20} />
                  <Text style={styles.buttonText}>
                    {assets.length
                      ? t('analysisBatch.continueAdding')
                      : t('analysisBatch.addAudio')}
                  </Text>
                </Pressable>
                <Text style={styles.hint}>{t('analysisBatch.audioLimit')}</Text>
              </View>
            ) : (
              <View style={styles.list}>
                {audioFiles.length ? (
                  audioFiles.map((audio) => {
                    const selected = selectedAudioIds.includes(audio.id);
                    const disabledReason = existingAudioDisabledReason(
                      audio,
                      runtimeMode,
                      t,
                      pipeline.includeEmotion,
                    );
                    return (
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{
                          checked: selected,
                          disabled: Boolean(disabledReason),
                        }}
                        disabled={Boolean(disabledReason)}
                        key={audio.id}
                        onPress={() =>
                          setSelectedAudioIds((current) =>
                            selected
                              ? current.filter((id) => id !== audio.id)
                              : current.length < 20
                                ? [...current, audio.id]
                                : current,
                          )
                        }
                        style={[
                          styles.checkRow,
                          selected && styles.checkRowSelected,
                          disabledReason && styles.disabled,
                        ]}
                      >
                        <Ionicons
                          color={selected ? colors.success : colors.muted}
                          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                          size={22}
                        />
                        <Text numberOfLines={1} style={styles.checkLabel}>
                          {audio.title}
                        </Text>
                        <View style={styles.checkMeta}>
                          <Text style={styles.hint}>
                            {audio.runtimeMode ?? t('analysisBatch.unknownMode')}
                          </Text>
                          {disabledReason ? (
                            <Text style={styles.danger}>{disabledReason}</Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })
                ) : (
                  <Text style={styles.hint}>{t('analysisBatch.noAudio')}</Text>
                )}
              </View>
            )}
          </View>
        </View>
        <View style={styles.section}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: moreSettingsExpanded }}
            onPress={() => setMoreSettingsExpanded((expanded) => !expanded)}
            style={({ pressed }) => [styles.settingsHeader, pressed && styles.choicePressed]}
          >
            <View>
              <Text style={styles.sectionTitle}>{t('analysisBatch.moreSettings')}</Text>
              {!moreSettingsExpanded ? (
                <Text style={styles.hint}>
                  {t('analysisBatch.settingsSummary', {
                    language: t(
                      analysisLanguage === 'zh-CN'
                        ? 'analysisLanguage.zhCN'
                        : 'analysisLanguage.en',
                    ),
                    timing: t(scheduled ? 'analysisBatch.later' : 'analysisBatch.now'),
                  })}
                </Text>
              ) : null}
            </View>
            <Ionicons
              color={colors.secondary}
              name={moreSettingsExpanded ? 'chevron-up' : 'chevron-down'}
              size={20}
            />
          </Pressable>
          {moreSettingsExpanded ? (
            <View style={styles.settingsBody}>
              <Text style={styles.contextLabel}>{t('analysisBatch.languageLabel')}</Text>
              <AnalysisLanguagePicker
                selectionStyle="accent"
                value={analysisLanguage}
                onChange={setAnalysisLanguage}
              />
              <Text style={styles.contextLabel}>{t('analysisBatch.timeLabel')}</Text>
              <ChoiceRow
                items={[
                  { id: 'now', label: t('analysisBatch.now') },
                  { id: 'later', label: t('analysisBatch.later') },
                ]}
                selected={scheduled ? 'later' : 'now'}
                onSelect={(id) => setScheduled(id === 'later')}
              />
              {scheduled ? (
                <TextInput
                  accessibilityLabel={t('analysisBatch.scheduleLabel')}
                  onChangeText={setScheduledText}
                  placeholder={t('analysisBatch.schedulePlaceholder')}
                  style={styles.input}
                  value={scheduledText}
                />
              ) : null}
              {incompatibility ? (
                <Text accessibilityRole="alert" style={styles.danger}>
                  {incompatibility}
                </Text>
              ) : null}
              <Text style={styles.hint}>
                {t('analysisBatch.runtimeFrozen', {
                  mode: runtimeMode || t('analysisBatch.unknown'),
                })}
              </Text>
            </View>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel={t('analysisBatch.learnMore')}
          accessibilityRole="button"
          accessibilityState={{ expanded: backgroundDetailsVisible }}
          onPress={() => setBackgroundDetailsVisible(true)}
          style={({ pressed }) => [styles.backgroundNotice, pressed && styles.choicePressed]}
        >
          <Ionicons color={colors.secondary} name="information-circle-outline" size={20} />
          <Text style={styles.backgroundNoticeBody}>{t('analysisBatch.backgroundShort')}</Text>
          <Text style={styles.learnMore}>{t('analysisBatch.learnMore')}</Text>
        </Pressable>
        <View style={styles.summaryCard}>
          <View style={styles.sectionHeadingRow}>
            <Text style={styles.sectionTitle}>{t('analysisBatch.configSummary')}</Text>
            <Text style={styles.hint}>
              {t('analysisBatch.selectedAudioCount', { count: selectedCount })}
            </Text>
          </View>
          <Text style={styles.summaryPrimary}>
            {selectedSource?.name ?? t('analysisBatch.noSource')} ·{' '}
            {selectedGroup?.name ?? t('analysisBatch.chooseGroup')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: previewExpanded }}
            onPress={() => setPreviewExpanded((expanded) => !expanded)}
            style={({ pressed }) => [styles.configRow, pressed && styles.choicePressed]}
          >
            <View style={styles.contextCopy}>
              <Text style={styles.contextValue}>{t('analysisBatch.configDetail')}</Text>
              <Text style={styles.hint}>{t('analysisBatch.processSummary')}</Text>
            </View>
            <View style={styles.contextAction}>
              <Text style={styles.hint}>{t('analysisBatch.viewConfig')}</Text>
              <Ionicons
                color={colors.secondary}
                name={previewExpanded ? 'chevron-up' : 'chevron-forward'}
                size={20}
              />
            </View>
          </Pressable>
          {previewExpanded ? (
            <View style={styles.previewDetails}>
              <Text style={styles.preview}>{preview}</Text>
              <Text style={styles.hint}>
                {t(preference === 'full' ? 'recording.fullFlow' : 'recording.transcriptionFlow')}
              </Text>
              <Text style={styles.hint}>{t('analysisBatch.previewHint')}</Text>
            </View>
          ) : null}
        </View>
        {recentBatches.length ? (
          <Section title={t('analysisBatch.recentTitle')}>
            {recentBatches.slice(0, 3).map((batch) => (
              <Pressable
                accessibilityRole="button"
                key={batch.id}
                onPress={() =>
                  router.push({
                    pathname: '/analysis-batches/[id]',
                    params: { id: batch.id },
                  } as unknown as Href)
                }
                style={styles.recentRow}
              >
                <View>
                  <Text style={styles.recentName}>{batch.configurationSnapshot.groupName}</Text>
                  <Text style={styles.hint}>
                    {formatDateTime(batch.createdAt)} · {recentBatchStatus(batch)}
                    {batch.counts.partial + batch.counts.failed > 0
                      ? ` · ${t('analysisBatch.recentReminder', { count: batch.counts.partial + batch.counts.failed })}`
                      : ''}
                  </Text>
                </View>
                <Ionicons color={colors.secondary} name="chevron-forward" size={20} />
              </Pressable>
            ))}
          </Section>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: ctaDisabled }}
          disabled={ctaDisabled}
          onPress={() => void submit()}
          style={[styles.primaryButton, ctaDisabled && styles.disabled]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.primaryText}>
              {sourceKind === 'uploads'
                ? t('analysisBatch.uploadAndStart')
                : t('analysisBatch.startExisting')}
            </Text>
          )}
        </Pressable>
      </View>
      <ActionSheet
        items={sourceSheetItems}
        onClose={() => setSourceSheetVisible(false)}
        title={t('analysisBatch.selectSource')}
        visible={sourceSheetVisible}
      />
      <ActionSheet
        items={groupSheetItems}
        message={groups.length ? undefined : t('analysisBatch.noGroups')}
        onClose={() => setGroupSheetVisible(false)}
        title={t('analysisBatch.selectGroup')}
        visible={groupSheetVisible}
      />
      <ActionSheet
        message={t('analysisBatch.backgroundNoticeBody')}
        onClose={() => setBackgroundDetailsVisible(false)}
        title={t('analysisBatch.backgroundDetailsTitle')}
        visible={backgroundDetailsVisible}
      />
    </SafeAreaView>
  );
}

function existingAudioDisabledReason(
  audio: AudioFileSummary,
  runtimeMode: string,
  t: (key: TranslationKey, options?: Record<string, unknown>) => string,
  includeEmotion: boolean,
): string | null {
  if (!runtimeMode) return t('analysisBatch.readingRuntime');
  if (
    audio.runtimeMode === 'lightweight_local' &&
    includeEmotion &&
    audio.sourceState !== 'available' &&
    !audio.acousticEmotionReady
  ) {
    return t('analysisBatch.remountRequired');
  }
  return null;
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChoiceRow({
  items,
  maxVisibleItems,
  selected,
  onSelect,
}: {
  items: { id: string; label: string }[];
  maxVisibleItems?: number;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useAppLanguage();
  const itemSignature = JSON.stringify(items.map((item) => [item.id, item.label]));
  const [expandedState, setExpandedState] = useState({ expanded: false, signature: '' });
  const expanded = expandedState.signature === itemSignature && expandedState.expanded;

  const visibleItems = useMemo(() => {
    if (!maxVisibleItems || maxVisibleItems < 1 || items.length <= maxVisibleItems || expanded) {
      return items;
    }
    const firstItems = items.slice(0, maxVisibleItems);
    const selectedItem = items.find((item) => item.id === selected);
    if (!selectedItem || firstItems.some((item) => item.id === selected)) return firstItems;
    return [...firstItems.slice(0, maxVisibleItems - 1), selectedItem];
  }, [expanded, items, maxVisibleItems, selected]);
  const canExpand = Boolean(
    maxVisibleItems && maxVisibleItems > 0 && items.length > maxVisibleItems,
  );

  return (
    <View style={styles.choices}>
      {visibleItems.map((item) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: item.id === selected }}
          key={item.id}
          onPress={() => onSelect(item.id)}
          style={[styles.choice, item.id === selected && styles.choiceSelected]}
        >
          <Text style={styles.choiceText}>{item.label}</Text>
        </Pressable>
      ))}
      {canExpand ? (
        <Pressable
          accessibilityLabel={
            expanded
              ? t('analysisBatch.collapseChoices')
              : t('analysisBatch.expandChoices', {
                  count: items.length - maxVisibleItems!,
                })
          }
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpandedState({ expanded: !expanded, signature: itemSignature })}
          style={({ pressed }) => [styles.choiceExpander, pressed && styles.choicePressed]}
        >
          <Ionicons color={colors.ink} name={expanded ? 'chevron-up' : 'chevron-down'} size={18} />
          <Text style={styles.choiceExpanderText}>
            {expanded
              ? t('analysisBatch.collapseChoices')
              : t('analysisBatch.expandChoices', {
                  count: items.length - maxVisibleItems!,
                })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.canvas, flex: 1 },
  center: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xxl + 72,
    paddingHorizontal: spacing.md,
  },
  section: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.base,
    padding: spacing.md,
  },
  sectionTitle: { ...typography.heading2, color: textColors.primary, fontWeight: 'bold' },
  sectionHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  contextHeadingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  contextLabel: { ...typography.heading3, color: textColors.primary, fontWeight: 'bold' },
  contextRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 52,
  },
  contextCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
  contextValue: { ...typography.body, color: textColors.primary, fontWeight: 'bold' },
  contextAction: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  required: { ...typography.description, color: textColors.primary, fontWeight: 'bold' },
  separator: { backgroundColor: colors.divider, height: StyleSheet.hairlineWidth },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  choiceSelected: { backgroundColor: colors.successSurface, borderColor: colors.success },
  choicePressed: { opacity: 0.65 },
  choiceText: { ...typography.body, color: textColors.primary },
  choiceExpander: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  choiceExpanderText: { ...typography.body, color: textColors.primary },
  segmentedControl: {
    backgroundColor: colors.background,
    borderRadius: radii.round,
    flexDirection: 'row',
    padding: spacing.xs,
  },
  segment: {
    alignItems: 'center',
    borderRadius: radii.round,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  segmentSelected: { backgroundColor: colors.successSurface },
  segmentText: { ...typography.body, color: textColors.secondary },
  segmentTextSelected: { color: textColors.primary, fontWeight: 'bold' },
  audioInput: { gap: spacing.sm },
  assetList: { gap: spacing.xs },
  assetRow: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  assetCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
  assetName: { ...typography.body, color: textColors.primary },
  addAudioButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.base,
  },
  buttonText: { ...typography.body, color: textColors.primary },
  list: { gap: spacing.sm },
  checkRow: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  checkRowSelected: { backgroundColor: colors.successSurface },
  checkMeta: { alignItems: 'flex-end', flexShrink: 1, gap: 2 },
  checkLabel: { ...typography.body, color: textColors.primary, flex: 1 },
  settingsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  settingsBody: { gap: spacing.base },
  input: {
    ...typography.body,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    padding: spacing.base,
  },
  hint: { ...typography.description, color: textColors.secondary },
  backgroundNotice: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  backgroundNoticeBody: { ...typography.description, color: textColors.secondary, flex: 1 },
  learnMore: { ...typography.description, color: textColors.primary, fontWeight: 'bold' },
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  summaryPrimary: { ...typography.body, color: textColors.primary, fontWeight: 'bold' },
  configRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 52,
  },
  previewDetails: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  preview: { ...typography.description, color: textColors.primary },
  danger: { ...typography.description, color: colors.danger },
  footer: {
    backgroundColor: colors.card,
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryText: { ...typography.body, color: colors.white, fontWeight: 'bold' },
  disabled: { opacity: 0.5 },
  recentName: { ...typography.body, color: textColors.primary, fontWeight: 'bold' },
  recentRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
  },
});
