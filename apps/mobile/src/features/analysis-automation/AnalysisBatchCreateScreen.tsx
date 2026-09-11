/**
 * 一键式音频分析批次创建页。
 *
 * 提供数据源、单一分组、新上传或已有音频、立即或指定时间以及冻结配置预览，提交后进入
 * 批次详情观察服务端全流程。
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
import { AnalysisLanguagePicker } from '@/shared/i18n/AnalysisLanguagePicker';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import type { TranslationKey } from '@/shared/i18n/translations';

const pipeline = {
  confirmation: 'system_raw_snapshot' as const,
  includeEmotion: true,
  includeRole: true,
  includeBusinessAnalysis: true,
  transcriptPolicy: 'reuse_or_create' as const,
};

/** 渲染新建标签的一键分析表单。 */
export function AnalysisBatchCreateScreen() {
  const router = useRouter();
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
          return audio ? existingAudioDisabledReason(audio, runtime.mode, t) === null : false;
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
  }, [appLanguage, groupId, sourceId, t]);
  const screenRefresh = useScreenRefresh(refreshPage);

  const selectedCount = sourceKind === 'uploads' ? assets.length : selectedAudioIds.length;
  const incompatibility = useMemo(
    () =>
      scheduled && runtimeMode === 'lightweight_local'
        ? t('analysisBatch.lightweightSchedule')
        : null,
    [runtimeMode, scheduled, t],
  );

  async function pickFiles() {
    try {
      const result = await pickDocumentAsync({
        type: 'audio/*',
        multiple: true,
        copyToCacheDirectory: false,
      });
      if (result && !result.canceled) setAssets(result.assets.slice(0, 20));
    } catch (error) {
      Alert.alert('选择音频失败', error instanceof Error ? error.message : '请稍后重试。');
    }
  }

  function selectSource(id: string) {
    setSourceId(id);
    setGroupId('');
    setSelectedAudioIds([]);
    setPreview(t('analysisBatch.previewEmpty'));
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
    setSubmitting(true);
    try {
      const common = {
        dataSourceId: sourceId,
        groupId,
        language: analysisLanguage,
        scheduledFor: scheduledFor(),
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
      <TopLevelPageHeader subtitle={t('analysisBatch.subtitle')} title={t('analysisBatch.title')} />
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
        <View collapsable={false} ref={sourceTourRef}>
          <Section title={t('analysisBatch.sourceStep')}>
            <ChoiceRow
              items={sources.map((item) => ({ id: item.id, label: item.name }))}
              maxVisibleItems={4}
              selected={sourceId}
              onSelect={selectSource}
            />
          </Section>
        </View>
        <View collapsable={false} ref={groupTourRef}>
          <Section title={t('analysisBatch.groupStep')}>
            {groups.length ? (
              <ChoiceRow
                items={groups.map((item) => ({ id: item.id, label: item.name }))}
                maxVisibleItems={4}
                selected={groupId}
                onSelect={setGroupId}
              />
            ) : (
              <Text style={styles.hint}>{t('analysisBatch.noGroups')}</Text>
            )}
          </Section>
        </View>
        <View collapsable={false} ref={audioTourRef}>
          <Section title={t('analysisBatch.audioStep')}>
            <ChoiceRow
              items={[
                { id: 'uploads', label: t('analysisBatch.uploads') },
                { id: 'existing_audio', label: t('analysisBatch.existing') },
              ]}
              selected={sourceKind}
              onSelect={(id) => setSourceKind(id as typeof sourceKind)}
            />
            {sourceKind === 'uploads' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void pickFiles()}
                style={styles.secondaryButton}
              >
                <Ionicons color={colors.ink} name="cloud-upload-outline" size={20} />
                <Text style={styles.buttonText}>
                  {t('analysisBatch.pickFiles', { count: assets.length })}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.list}>
                {audioFiles.map((audio) => {
                  const selected = selectedAudioIds.includes(audio.id);
                  const disabledReason = existingAudioDisabledReason(audio, runtimeMode, t);
                  return (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected, disabled: Boolean(disabledReason) }}
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
                      style={[styles.checkRow, disabledReason && styles.disabled]}
                    >
                      <Ionicons
                        color={selected ? colors.success : colors.muted}
                        name={selected ? 'checkbox' : 'square-outline'}
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
                })}
              </View>
            )}
          </Section>
        </View>
        <Section title={t('analysisBatch.languageStep')}>
          <AnalysisLanguagePicker value={analysisLanguage} onChange={setAnalysisLanguage} />
        </Section>
        <Section title={t('analysisBatch.timeStep')}>
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
        </Section>
        <Section title={t('analysisBatch.previewStep')}>
          <Text style={styles.preview}>{preview}</Text>
          <Text style={styles.hint}>{t('analysisBatch.previewHint')}</Text>
        </Section>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: submitting }}
          disabled={submitting}
          onPress={() => void submit()}
          style={[styles.primaryButton, submitting && styles.disabled]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.primaryText}>{t('analysisBatch.start')}</Text>
          )}
        </Pressable>
        {recentBatches.length ? (
          <Section title={t('analysisBatch.recent')}>
            {recentBatches.slice(0, 5).map((batch) => (
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
                  <Text style={styles.buttonText}>{batch.configurationSnapshot.groupName}</Text>
                  <Text style={styles.hint}>
                    {t('analysisBatch.recentCounts', {
                      date: formatDateTime(batch.createdAt),
                      completed: batch.counts.completed,
                      partial: batch.counts.partial,
                      failed: batch.counts.failed,
                    })}
                  </Text>
                </View>
                <Ionicons color={colors.secondary} name="chevron-forward" size={20} />
              </Pressable>
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function existingAudioDisabledReason(
  audio: AudioFileSummary,
  runtimeMode: string,
  t: (key: TranslationKey, options?: Record<string, unknown>) => string,
): string | null {
  if (!runtimeMode) return t('analysisBatch.readingRuntime');
  if (audio.runtimeMode !== runtimeMode)
    return t('analysisBatch.modeMismatch', {
      mode: audio.runtimeMode ?? t('analysisBatch.unknown'),
    });
  if (
    runtimeMode === 'lightweight_local' &&
    pipeline.includeEmotion &&
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
  content: { gap: spacing.md, paddingBottom: spacing.xxl, paddingHorizontal: spacing.md },
  section: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.base,
    padding: spacing.md,
  },
  sectionTitle: { ...typography.heading2, color: textColors.primary, fontWeight: 'bold' },
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
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.base,
  },
  buttonText: { ...typography.body, color: textColors.primary },
  list: { gap: spacing.sm },
  checkRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 40 },
  checkMeta: { alignItems: 'flex-end', flexShrink: 1, gap: 2 },
  checkLabel: { ...typography.body, color: textColors.primary, flex: 1 },
  input: {
    ...typography.body,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    padding: spacing.base,
  },
  hint: { ...typography.description, color: textColors.secondary },
  preview: { ...typography.description, color: textColors.primary },
  danger: { ...typography.description, color: colors.danger },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryText: { ...typography.body, color: colors.white, fontWeight: 'bold' },
  disabled: { opacity: 0.5 },
  recentRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
  },
});
