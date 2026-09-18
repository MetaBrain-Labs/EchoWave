/**
 * 手机录音与原件管理页面。
 *
 * 以分析上下文、核心录音控制和最近录音三层结构组织本机录音，同时保留全部上传与恢复能力。
 *
 * Responsibilities:
 * - 展示应用级录音状态与本机草稿。
 * - 协调试听、命名、导出、删除、暂存和按需分析。
 * - 将大量数据源收进可滚动操作菜单，避免占满移动端首屏。
 *
 * Notes:
 * - 所有网络操作由共享录音协调器执行，页面不保存分析结果。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type {
  AudioRuntimeMode,
  DataSourceSummary,
  LinkedDataSourceGroup,
} from '@echowave/contracts';
import { useRouter, type Href } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiUrl } from '@/shared/api/apiUrl';
import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';
import { listDataSourceGroups, listDataSources } from '@/shared/api/dataSourcesApi';
import { useAudioPlayback } from '@/shared/audio/useAudioPlayback';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import type { TranslationKey } from '@/shared/i18n/translations';
import { analyzeRecording, storeRecording } from '@/shared/recording/recordingOperations';
import { useRecording } from '@/shared/recording/RecordingProvider';
import { recordingFile, type RecordingDraft } from '@/shared/recording/recordingStore';
import { useAnalysisPreference } from '@/shared/settings/AnalysisPreferenceProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { ActionSheet, type ActionSheetItem } from '@/shared/ui/ActionSheet';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';
import { textInputText } from '@/shared/theme/textInput';

type TranslationFunction = ReturnType<typeof useAppLanguage>['t'];

/** 显示受控错误键，服务端错误保留其安全可操作说明。 */
export function recordingError(reason: unknown, t: TranslationFunction) {
  const message = reason instanceof Error ? reason.message : '';
  const keys = [
    'recording.fileUnavailable',
    'recording.tooLarge',
    'recording.serverChanged',
    'recording.sessionExpired',
  ];
  return keys.includes(message)
    ? t(message as TranslationKey)
    : message || t('recording.operationFailed');
}

/** 将毫秒时长压缩为卡片元数据，不展示无意义的小数。 */
function durationLabel(durationMs: number, t: TranslationFunction): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return t('recording.seconds', { count: totalSeconds });
  return t('recording.minutes', {
    minutes: Math.floor(totalSeconds / 60),
    seconds: String(totalSeconds % 60).padStart(2, '0'),
  });
}

/** 以本地日期生成“今天/昨天/日期 + 时间”的移动端元数据。 */
function recordedAtLabel(
  createdAt: string,
  language: 'zh-CN' | 'en',
  t: TranslationFunction,
): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return createdAt;
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const createdStart = new Date(
    created.getFullYear(),
    created.getMonth(),
    created.getDate(),
  ).getTime();
  const time = created.toLocaleTimeString(language, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const dayDifference = Math.round((dayStart - createdStart) / 86_400_000);
  if (dayDifference === 0) return `${t('recording.today')} ${time}`;
  if (dayDifference === 1) return `${t('recording.yesterday')} ${time}`;
  return `${created.toLocaleDateString(language, { month: 'short', day: 'numeric' })} ${time}`;
}

/** 历史默认名称在界面上压缩为时间，用户自定义名称保持原样。 */
function visibleDraftTitle(title: string, createdAt: string, language: 'zh-CN' | 'en'): string {
  if (!/^(录音|Recording) \d{4}-\d{2}-\d{2}/.test(title)) return title;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return title;
  const prefix = language === 'zh-CN' ? '录音' : 'Recording';
  return `${prefix} ${created.toLocaleTimeString(language, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`;
}

/** 以 mm:ss 或 h:mm:ss 展示实时录音时长。 */
function recordingClock(durationMs: number): string {
  const total = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 已结束录音的紧凑操作卡片，成功上传后手机原件仍可独立管理。 */
function DraftCard({
  draft,
  sourceId,
  groupId,
  mode,
}: {
  draft: RecordingDraft;
  sourceId: string;
  groupId: string;
  mode?: AudioRuntimeMode;
}) {
  const recording = useRecording();
  const { preference, hydrated } = useAnalysisPreference();
  const { t, language } = useAppLanguage();
  const router = useRouter();
  const [title, setTitle] = useState(draft.title);
  const [pending, setPending] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const playback = useAudioPlayback(draft.id, () => recordingFile(draft).uri);
  const bound = draft.serverUrl === getApiUrl() && Boolean(draft.dataSourceId);
  const canRename = !pending && !draft.session && !draft.batchRequest;

  const run = async (action: (value: RecordingDraft) => Promise<void>): Promise<boolean> => {
    if (pending || recording.activeId) return false;
    setPending(true);
    try {
      const value = { ...draft, title: title.trim().slice(0, 200) || draft.title };
      await recording.update(value);
      await action(value);
      return true;
    } catch (reason) {
      Alert.alert(t('common.saveFailed'), recordingError(reason, t));
      return false;
    } finally {
      setPending(false);
    }
  };

  const saveTitle = async () => {
    if (await run(async () => {})) setEditing(false);
  };

  const openAnalysis = () =>
    void run(async (value) => {
      const submitted = await analyzeRecording(
        value,
        groupId,
        language,
        preference,
        recording.update,
      );
      Alert.alert(t('recording.submitted'), t('recording.backgroundAccepted'));
      router.push({
        pathname: '/analysis-batches/[id]',
        params: { id: submitted.batchId },
      } as unknown as Href);
    });

  const menuItems: ActionSheetItem[] = [
    {
      id: 'rename',
      disabled: !canRename,
      icon: 'pencil-outline',
      label: t('recording.rename'),
      onPress: () => setEditing(true),
    },
    {
      id: 'export',
      icon: 'share-outline',
      label: t('recording.export'),
      onPress: () =>
        void run(async (value) => {
          if (!(await Sharing.isAvailableAsync())) {
            throw new Error(t('recording.exportUnavailable'));
          }
          await Sharing.shareAsync(recordingFile(value).uri, {
            mimeType: 'audio/mp4',
            UTI: 'public.mpeg-4-audio',
          });
        }),
    },
    ...(!draft.audioFileId && !draft.batchRequest
      ? [
          {
            id: 'store',
            disabled: !bound || !mode,
            icon: 'archive-outline' as const,
            label: t('recording.store'),
            onPress: () =>
              void run(async (value) => {
                await storeRecording(value, recording.update, mode);
                Alert.alert(
                  t('recording.saved'),
                  t(
                    mode === 'lightweight_local'
                      ? 'recording.localOnly'
                      : 'recording.originalRetained',
                  ),
                );
              }),
          },
        ]
      : []),
    ...(!bound && !draft.session && !draft.batchRequest && !draft.audioFileId
      ? [
          {
            id: 'assign',
            disabled: !sourceId,
            icon: 'link-outline' as const,
            label: t('recording.assign'),
            onPress: () =>
              void run((value) =>
                recording.update({ ...value, serverUrl: getApiUrl(), dataSourceId: sourceId }),
              ),
          },
        ]
      : []),
    ...(draft.batchRequest
      ? [
          {
            id: 'pipeline',
            icon: 'list-outline' as const,
            label: t('recording.pipelineDetails'),
            onPress: () =>
              Alert.alert(
                t('recording.pipelineTitle'),
                t(
                  draft.batchRequest?.pipeline.includeEmotion
                    ? 'recording.fullFlow'
                    : 'recording.transcriptionFlow',
                ),
              ),
          },
        ]
      : []),
    {
      id: 'delete',
      destructive: true,
      disabled: Boolean(recording.activeId),
      icon: 'trash-outline',
      label: t('recording.deleteOriginal'),
      onPress: () =>
        Alert.alert(t('recording.deleteOriginal'), t('recording.deleteBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('recording.deleteOriginal'),
            style: 'destructive',
            onPress: () => void run((value) => recording.remove(value)),
          },
        ]),
    },
  ];

  const submitted = draft.state === 'submitted';
  const submitting = draft.state === 'submitting' || pending;
  const analyzeDisabled =
    pending || !bound || (!groupId && !submitted) || !hydrated || Boolean(recording.activeId);

  return (
    <View style={styles.recordingCard}>
      <View style={styles.recordingHeader}>
        <View style={styles.recordingTitleCopy}>
          <Text numberOfLines={1} style={styles.recordingTitle}>
            {visibleDraftTitle(title, draft.createdAt, language)}
          </Text>
          <Text style={styles.metadata}>
            {recordedAtLabel(draft.createdAt, language, t)} · {durationLabel(draft.durationMs, t)} ·{' '}
            {(draft.sizeBytes / 1024 / 1024).toFixed(1)} MB
          </Text>
        </View>
        <Pressable
          accessibilityLabel={t('recording.moreActions')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setMenuVisible(true)}
          style={({ pressed }) => [styles.iconButton, pressed && styles.softPressed]}
        >
          <Ionicons color={textColors.secondary} name="ellipsis-horizontal" size={22} />
        </Pressable>
      </View>

      {editing ? (
        <View style={styles.renameEditor}>
          <TextInput
            accessibilityLabel={t('recording.name')}
            autoFocus
            maxLength={200}
            onChangeText={setTitle}
            onSubmitEditing={() => void saveTitle()}
            returnKeyType="done"
            style={styles.nameInput}
            value={title}
          />
          <View style={styles.renameActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setTitle(draft.title);
                setEditing(false);
              }}
              style={styles.ghostButton}
            >
              <Text style={styles.secondaryButtonText}>{t('recording.cancelRename')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void saveTitle()}
              style={styles.compactPrimaryButton}
            >
              <Text style={styles.primaryButtonText}>{t('recording.saveName')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.statusRow}>
        {submitting ? (
          <ActivityIndicator color={colors.ink} size="small" />
        ) : (
          <Ionicons
            color={submitted ? colors.success : textColors.tertiary}
            name={submitted ? 'checkmark-circle' : 'phone-portrait-outline'}
            size={18}
          />
        )}
        <Text style={styles.statusText}>
          {submitting
            ? t('recording.submittingStatus')
            : submitted
              ? t('recording.submittedStatus')
              : draft.audioFileId
                ? t('recording.retainedStatus')
                : t('recording.localStatus')}
        </Text>
      </View>

      {draft.interrupted ? (
        <Text accessibilityRole="alert" style={styles.warningText}>
          {t('recording.interrupted')}
        </Text>
      ) : null}
      {playback.error ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {playback.error}
        </Text>
      ) : null}
      {!bound ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {t('recording.serverChanged')}
        </Text>
      ) : null}

      <View style={styles.primaryActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: Boolean(recording.activeId) }}
          disabled={Boolean(recording.activeId)}
          onPress={() => void playback.toggleFullPlayback()}
          style={({ pressed }) => [
            styles.playButton,
            Boolean(recording.activeId) && styles.disabled,
            pressed && styles.softPressed,
          ]}
        >
          <Ionicons color={colors.ink} name={playback.isPlaying ? 'pause' : 'play'} size={18} />
          <Text style={styles.secondaryButtonText}>
            {t(playback.isPlaying ? 'recording.pausePlayback' : 'recording.listen')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: analyzeDisabled }}
          disabled={analyzeDisabled}
          onPress={openAnalysis}
          style={({ pressed }) => [
            styles.analysisButton,
            analyzeDisabled && styles.disabled,
            pressed && styles.primaryPressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {submitted
              ? t('recording.openTask')
              : draft.batchRequest
                ? t('recording.continueSubmission')
                : t('recording.analyze')}
          </Text>
          <Ionicons color={colors.white} name="arrow-forward" size={18} />
        </Pressable>
      </View>

      <ActionSheet
        busy={pending}
        items={menuItems}
        onClose={() => setMenuVisible(false)}
        title={visibleDraftTitle(title, draft.createdAt, language)}
        visible={menuVisible}
      />
    </View>
  );
}

/** 录音入口与所有本机原件管理，网络不可用时仍可录音。 */
export function RecordingScreen({
  sourceId: initialSourceId = '',
  draftId,
  onBack,
  onOpenSettings,
}: {
  sourceId?: string;
  draftId?: string;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  const recording = useRecording();
  const { t } = useAppLanguage();
  const [sources, setSources] = useState<DataSourceSummary[]>([]);
  const [sourceId, setSourceId] = useState(initialSourceId);
  const [groups, setGroups] = useState<LinkedDataSourceGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [mode, setMode] = useState<AudioRuntimeMode>();
  const [loadError, setLoadError] = useState('');
  const [sourceMenuVisible, setSourceMenuVisible] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([listDataSources(), getAudioRuntime()])
      .then(([sourceResponse, runtime]) => {
        if (active) {
          setSources(sourceResponse.items);
          setSourceId((current) => current || sourceResponse.items[0]?.id || '');
          setMode(runtime.mode);
        }
      })
      .catch((reason) => {
        if (active) setLoadError(recordingError(reason, t));
      });
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    let active = true;
    if (!sourceId) return;
    void listDataSourceGroups(sourceId)
      .then((response) => {
        if (active) {
          setGroups(response.items);
          setGroupId(response.items[0]?.id ?? '');
        }
      })
      .catch((reason) => {
        if (active) setLoadError(recordingError(reason, t));
      });
    return () => {
      active = false;
    };
  }, [sourceId, t]);

  const selectSource = (nextSourceId: string) => {
    if (nextSourceId === sourceId) return;
    setSourceId(nextSourceId);
    setGroups([]);
    setGroupId('');
  };
  const selectedSource = sources.find((source) => source.id === sourceId);
  const selectedDraft = recording.drafts.find((draft) => draft.id === draftId);
  const drafts = (selectedDraft ? [selectedDraft] : recording.drafts).filter(
    (draft) => draft.state !== 'recording',
  );

  const sourceItems = sources.map<ActionSheetItem>((source) => ({
    id: source.id,
    icon: source.id === sourceId ? 'radio-button-on' : 'radio-button-off',
    label: source.name,
    onPress: () => selectSource(source.id),
  }));

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.page}>
      <TopLevelPageHeader
        actions={[
          {
            accessibilityLabel: t('recording.openSettings'),
            icon: 'settings-outline',
            onPress: onOpenSettings,
            size: 22,
          },
        ]}
        onBack={onBack}
        title={t('recording.title')}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {Platform.OS === 'web' ? (
          <View style={styles.webNotice}>
            <Ionicons color={textColors.secondary} name="phone-portrait-outline" size={24} />
            <Text style={styles.secondaryText}>{t('recording.nativeOnly')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                {t('recording.context')}
              </Text>
              {loadError ? (
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {loadError}
                </Text>
              ) : null}
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>{t('recording.sourceLabel')}</Text>
                <Pressable
                  accessibilityLabel={t('recording.chooseSource')}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: sources.length === 0 }}
                  disabled={sources.length === 0}
                  onPress={() => setSourceMenuVisible(true)}
                  style={({ pressed }) => [styles.sourceSelector, pressed && styles.softPressed]}
                >
                  <View style={styles.sourceCopy}>
                    <Text numberOfLines={1} style={styles.sourceName}>
                      {selectedSource?.name ?? t('recording.noSource')}
                    </Text>
                    <Text style={styles.metadata}>
                      {selectedSource
                        ? `${t('recording.currentSelection')} · ${t('recording.changeSource')}`
                        : t('recording.chooseSource')}
                    </Text>
                  </View>
                  <Ionicons color={textColors.tertiary} name="chevron-forward" size={20} />
                </Pressable>
              </View>
              <View style={styles.fieldBlock}>
                <View style={styles.fieldHeading}>
                  <Text style={styles.fieldLabel}>{t('recording.groupLabel')}</Text>
                  <Text style={styles.requiredLabel}>{t('recording.groupRequired')}</Text>
                </View>
                <Text style={styles.secondaryText}>{t('recording.groupDescription')}</Text>
                {groups.length ? (
                  <ScrollView
                    contentContainerStyle={styles.groupChoices}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {groups.map((group) => (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ checked: group.id === groupId }}
                        key={group.id}
                        onPress={() => setGroupId(group.id)}
                        style={[styles.groupChip, group.id === groupId && styles.groupChipSelected]}
                      >
                        <Text
                          style={[
                            styles.groupChipText,
                            group.id === groupId && styles.groupChipTextSelected,
                          ]}
                        >
                          {group.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.metadata}>{t('analysisBatch.noGroups')}</Text>
                )}
              </View>
            </View>

            <View style={styles.section}>
              {recording.error ? (
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {recording.error}
                </Text>
              ) : null}
              {recording.activeId ? (
                <View style={styles.activeRecordingControl}>
                  <View style={styles.activeStatusRow}>
                    <View style={styles.recordingDot} />
                    <Text accessibilityLiveRegion="polite" style={styles.activeStatusText}>
                      {t(recording.isRecording ? 'recording.capturing' : 'recording.paused')}
                    </Text>
                  </View>
                  <Text style={styles.recordingTime}>{recordingClock(recording.durationMs)}</Text>
                  <View accessibilityElementsHidden style={styles.levelIndicator}>
                    {[16, 28, 20, 34, 24, 30, 18].map((height, index) => (
                      <View
                        key={`${height}-${index}`}
                        style={[
                          styles.levelBar,
                          { height, opacity: recording.isRecording ? 1 : 0.35 },
                        ]}
                      />
                    ))}
                  </View>
                  <View style={styles.activeActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={recording.busy}
                      onPress={() =>
                        void (recording.isRecording ? recording.pause() : recording.resume()).catch(
                          (reason) =>
                            Alert.alert(t('recording.operationFailed'), recordingError(reason, t)),
                        )
                      }
                      style={({ pressed }) => [
                        styles.activeSecondaryButton,
                        recording.busy && styles.disabled,
                        pressed && styles.activePressed,
                      ]}
                    >
                      <Ionicons
                        color={colors.white}
                        name={recording.isRecording ? 'pause' : 'play'}
                        size={19}
                      />
                      <Text style={styles.activeSecondaryText}>
                        {t(recording.isRecording ? 'recording.pause' : 'recording.resume')}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={recording.busy}
                      onPress={() =>
                        void recording
                          .stop()
                          .catch((reason) =>
                            Alert.alert(t('recording.operationFailed'), recordingError(reason, t)),
                          )
                      }
                      style={({ pressed }) => [
                        styles.stopButton,
                        recording.busy && styles.disabled,
                        pressed && styles.stopPressed,
                      ]}
                    >
                      <Ionicons color={colors.ink} name="stop" size={18} />
                      <Text style={styles.stopButtonText}>{t('recording.finish')}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityLabel={t('recording.start')}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: recording.busy }}
                  disabled={recording.busy}
                  onPress={() => void recording.start(getApiUrl(), sourceId)}
                  style={({ pressed }) => [
                    styles.startRecordingControl,
                    recording.busy && styles.disabled,
                    pressed && styles.primaryPressed,
                  ]}
                >
                  {recording.busy ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <View style={styles.recordIcon}>
                      <Ionicons color={colors.ink} name="mic" size={26} />
                    </View>
                  )}
                  <Text style={styles.startRecordingTitle}>{t('recording.start')}</Text>
                  <Text style={styles.startRecordingHint}>{t('recording.startHint')}</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  Alert.alert(
                    t('recording.backgroundDetailsTitle'),
                    t('recording.backgroundRecording'),
                  )
                }
                style={({ pressed }) => [styles.infoRow, pressed && styles.softPressed]}
              >
                <Ionicons
                  color={textColors.secondary}
                  name="information-circle-outline"
                  size={18}
                />
                <Text numberOfLines={2} style={styles.infoText}>
                  {t('recording.backgroundSummary')}
                </Text>
                <Text style={styles.infoLink}>{t('recording.learnMore')}</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                {t('recording.recent')}
              </Text>
              {drafts.length ? (
                <View style={styles.recordingList}>
                  {drafts.map((draft) => (
                    <DraftCard
                      draft={draft}
                      groupId={groupId}
                      key={draft.id}
                      mode={mode}
                      sourceId={sourceId}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyText}>{t('recording.noRecent')}</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
      <ActionSheet
        items={sourceItems}
        onClose={() => setSourceMenuVisible(false)}
        title={t('recording.chooseSource')}
        visible={sourceMenuVisible}
      />
    </SafeAreaView>
  );
}

/** 数据源中只展示尚未上传的本机录音，不影响服务器计数。 */
export function RecordingDraftList({ sourceId }: { sourceId: string }) {
  const { drafts } = useRecording();
  const { t } = useAppLanguage();
  const router = useRouter();
  const local = drafts.filter(
    (draft) =>
      draft.dataSourceId === sourceId &&
      draft.serverUrl === getApiUrl() &&
      !draft.audioFileId &&
      !draft.session,
  );
  if (!local.length) return null;
  return (
    <View style={styles.pendingCard}>
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        {t('recording.pendingLocal')}
      </Text>
      <Text style={styles.secondaryText}>{t('recording.localOnly')}</Text>
      {local.map((draft) => (
        <Pressable
          accessibilityRole="button"
          key={draft.id}
          onPress={() =>
            router.push({
              pathname: '/recording',
              params: { sourceId, draftId: draft.id },
            } as unknown as Href)
          }
          style={({ pressed }) => [styles.pendingRow, pressed && styles.softPressed]}
        >
          <Text numberOfLines={1} style={styles.sourceName}>
            {draft.title}
          </Text>
          <Ionicons color={textColors.tertiary} name="chevron-forward" size={18} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.canvas, flex: 1 },
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  section: { gap: spacing.base },
  sectionTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  fieldBlock: { gap: spacing.sm },
  fieldHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  fieldLabel: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  requiredLabel: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
  },
  secondaryText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  sourceSelector: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.default,
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  sourceCopy: { flex: 1, gap: spacing.xs, marginRight: spacing.sm },
  sourceName: {
    ...typography.body,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  metadata: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  groupChoices: { gap: spacing.sm, paddingRight: spacing.md },
  groupChip: {
    alignItems: 'center',
    backgroundColor: colors.divider,
    borderRadius: radii.round,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  groupChipSelected: { backgroundColor: colors.ink },
  groupChipText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  groupChipTextSelected: { color: colors.white, fontFamily: fontFamilies.sansBold },
  startRecordingControl: {
    alignItems: 'center',
    backgroundColor: colors.black,
    borderRadius: radii.default,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 164,
    padding: spacing.lg,
  },
  recordIcon: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radii.round,
    height: 52,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    width: 52,
  },
  startRecordingTitle: {
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontSize: 18,
    fontWeight: 'bold',
    lineHeight: 26,
  },
  startRecordingHint: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  activeRecordingControl: {
    alignItems: 'center',
    backgroundColor: colors.black,
    borderRadius: radii.default,
    gap: spacing.base,
    minHeight: 220,
    padding: spacing.lg,
  },
  activeStatusRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  recordingDot: { backgroundColor: colors.danger, borderRadius: radii.round, height: 8, width: 8 },
  activeStatusText: {
    ...typography.description,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
  },
  recordingTime: {
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontSize: 36,
    fontVariant: ['tabular-nums'],
    lineHeight: 44,
  },
  levelIndicator: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    height: 36,
  },
  levelBar: { backgroundColor: colors.white, borderRadius: radii.round, width: 3 },
  activeActions: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  activeSecondaryButton: {
    alignItems: 'center',
    borderRadius: radii.default,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
  },
  activeSecondaryText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
  },
  stopButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radii.default,
    flex: 1.35,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
  },
  stopButtonText: {
    ...typography.body,
    color: colors.ink,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  infoRow: {
    alignItems: 'center',
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  infoText: {
    ...typography.description,
    color: textColors.secondary,
    flex: 1,
    fontFamily: fontFamilies.sans,
  },
  infoLink: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  recordingList: { gap: spacing.base },
  recordingCard: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.base,
    padding: spacing.md,
  },
  recordingHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  recordingTitleCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
  recordingTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: radii.round,
    height: 44,
    justifyContent: 'center',
    marginRight: -spacing.sm,
    marginTop: -spacing.sm,
    width: 44,
  },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 20 },
  statusText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  primaryActions: { flexDirection: 'row', gap: spacing.sm },
  playButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 46,
  },
  analysisButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 46,
  },
  secondaryButtonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  renameEditor: { gap: spacing.sm },
  nameInput: {
    ...textInputText,
    ...typography.body,
    backgroundColor: colors.background,
    borderRadius: radii.default,
    color: textColors.primary,
    height: 44,
    paddingHorizontal: spacing.base,
  },
  renameActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  ghostButton: {
    alignItems: 'center',
    borderRadius: radii.default,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.base,
  },
  compactPrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  warningText: { ...typography.description, color: textColors.secondary },
  errorText: { ...typography.description, color: colors.danger },
  emptyText: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    paddingVertical: spacing.base,
  },
  pendingCard: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  pendingRow: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flexDirection: 'row',
    minHeight: 48,
    paddingHorizontal: spacing.base,
  },
  webNotice: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.base,
    padding: spacing.md,
  },
  disabled: { opacity: 0.45 },
  softPressed: { opacity: 0.65 },
  primaryPressed: { opacity: 0.84 },
  activePressed: { backgroundColor: 'rgba(255, 255, 255, 0.12)' },
  stopPressed: { opacity: 0.82 },
});
