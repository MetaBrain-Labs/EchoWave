/**
 * 手机录音与原件管理页面。
 *
 * 为录音提供独立入口，上传或分析前选择有效的数据源与分组。
 *
 * Responsibilities:
 * - 展示应用级录音状态与本机草稿。
 * - 协调试听、命名、导出、删除、暂存和按需分析。
 *
 * Notes:
 * - 所有网络操作由共享录音协调器执行，页面不保存分析结果。
 */
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
import { useRouter, type Href } from 'expo-router';
import * as Sharing from 'expo-sharing';
import type {
  DataSourceSummary,
  LinkedDataSourceGroup,
  AudioRuntimeMode,
} from '@echowave/contracts';
import { useRecording } from '@/shared/recording/RecordingProvider';
import { recordingFile, type RecordingDraft } from '@/shared/recording/recordingStore';
import { analyzeRecording, storeRecording } from '@/shared/recording/recordingOperations';
import { useAudioPlayback } from '@/shared/audio/useAudioPlayback';
import { getApiUrl } from '@/shared/api/apiUrl';
import { listDataSources, listDataSourceGroups } from '@/shared/api/dataSourcesApi';
import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';
import { useAnalysisPreference } from '@/shared/settings/AnalysisPreferenceProvider';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import type { TranslationKey } from '@/shared/i18n/translations';
import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';

/** 显示受控错误键，服务端错误保留其安全可操作说明。 */
export function recordingError(reason: unknown, t: ReturnType<typeof useAppLanguage>['t']) {
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

/** 已结束录音的操作卡片，成功上传后手机原件仍可独立管理。 */
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
  const { t, language, formatDateTime } = useAppLanguage();
  const router = useRouter();
  const [title, setTitle] = useState(draft.title);
  const [pending, setPending] = useState(false);
  const playback = useAudioPlayback(draft.id, () => recordingFile(draft).uri);
  const bound = draft.serverUrl === getApiUrl() && Boolean(draft.dataSourceId);
  const run = async (action: (value: RecordingDraft) => Promise<void>) => {
    if (pending || recording.activeId) return;
    setPending(true);
    try {
      const value = { ...draft, title: title.trim().slice(0, 200) || draft.title };
      await recording.update(value);
      await action(value);
    } catch (reason) {
      Alert.alert(t('common.saveFailed'), recordingError(reason, t));
    } finally {
      setPending(false);
    }
  };
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: pending || disabled }}
      disabled={pending || disabled}
      onPress={action}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.card}>
      <Text>
        {formatDateTime(draft.createdAt)} · {(draft.durationMs / 1000).toFixed(0)} s ·{' '}
        {(draft.sizeBytes / 1024 / 1024).toFixed(1)} MB
      </Text>
      <TextInput
        accessibilityLabel={t('recording.name')}
        value={title}
        maxLength={200}
        editable={!pending && !draft.session && !draft.batchRequest}
        onChangeText={setTitle}
        onEndEditing={() => void run(async () => {})}
        style={styles.input}
      />
      <Text style={styles.hint}>
        {draft.audioFileId ? t('recording.originalRetained') : t('recording.localOnly')}
      </Text>
      {draft.interrupted ? (
        <Text accessibilityRole="alert">{t('recording.interrupted')}</Text>
      ) : null}
      {playback.error ? <Text accessibilityRole="alert">{playback.error}</Text> : null}
      {!bound ? <Text accessibilityRole="alert">{t('recording.serverChanged')}</Text> : null}
      {pending ? <ActivityIndicator /> : null}
      <View style={styles.actions}>
        {button(
          playback.isPlaying ? t('recording.pausePlayback') : t('recording.listen'),
          () => void playback.toggleFullPlayback(),
          Boolean(recording.activeId),
        )}
        {button(
          t('recording.export'),
          () =>
            void run(async (value) => {
              if (!(await Sharing.isAvailableAsync()))
                throw new Error(t('recording.exportUnavailable'));
              await Sharing.shareAsync(recordingFile(value).uri, {
                mimeType: 'audio/mp4',
                UTI: 'public.mpeg-4-audio',
              });
            }),
        )}
        {button(
          t('recording.deleteOriginal'),
          () =>
            Alert.alert(t('recording.deleteOriginal'), t('recording.deleteBody'), [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('recording.deleteOriginal'),
                style: 'destructive',
                onPress: () => void run((value) => recording.remove(value)),
              },
            ]),
          Boolean(recording.activeId),
        )}
      </View>
      {!bound && !draft.session && !draft.batchRequest && !draft.audioFileId
        ? button(
            t('recording.assign'),
            () =>
              void run((value) =>
                recording.update({ ...value, serverUrl: getApiUrl(), dataSourceId: sourceId }),
              ),
            !sourceId,
          )
        : null}
      <Text style={styles.hint}>
        {t(
          (draft.batchRequest ? draft.batchRequest.pipeline.includeEmotion : preference === 'full')
            ? 'recording.fullFlow'
            : 'recording.transcriptionFlow',
        )}
      </Text>
      <View style={styles.actions}>
        {!draft.audioFileId && !draft.batchRequest
          ? button(
              t('recording.store'),
              () =>
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
              !bound || !mode,
            )
          : null}
        {button(
          draft.state === 'submitted' ? t('recording.openTask') : t('recording.analyze'),
          () =>
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
            }),
          !bound || (!groupId && draft.state !== 'submitted') || !hydrated,
        )}
      </View>
    </View>
  );
}

/** 录音入口与所有本机原件管理，网络不可用时仍可录音。 */
export function RecordingScreen({
  sourceId: initialSourceId = '',
  draftId,
  onBack,
}: {
  sourceId?: string;
  draftId?: string;
  onBack: () => void;
}) {
  const recording = useRecording();
  const { t } = useAppLanguage();
  const [sources, setSources] = useState<DataSourceSummary[]>([]);
  const [sourceId, setSourceId] = useState(initialSourceId);
  const [groups, setGroups] = useState<LinkedDataSourceGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [mode, setMode] = useState<AudioRuntimeMode>();
  const [loadError, setLoadError] = useState('');
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
  const selected = recording.drafts.find((draft) => draft.id === draftId);
  const drafts = selected ? [selected] : recording.drafts;
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.page}>
      <TopLevelPageHeader title={t('recording.title')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {Platform.OS === 'web' ? (
          <Text>{t('recording.nativeOnly')}</Text>
        ) : (
          <>
            {loadError ? <Text accessibilityRole="alert">{loadError}</Text> : null}
            <Text accessibilityRole="header">{t('recording.source')}</Text>
            <View style={styles.actions}>
              {sources.map((source) => (
                <Pressable
                  key={source.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: source.id === sourceId }}
                  onPress={() => {
                    setSourceId(source.id);
                    setGroups([]);
                    setGroupId('');
                  }}
                  style={[styles.button, source.id === sourceId && styles.choiceSelected]}
                >
                  <Text
                    style={[styles.buttonText, source.id === sourceId && styles.choiceSelectedText]}
                  >
                    {source.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text accessibilityRole="header">{t('recording.group')}</Text>
            <View style={styles.actions}>
              {groups.map((group) => (
                <Pressable
                  key={group.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: group.id === groupId }}
                  onPress={() => setGroupId(group.id)}
                  style={[styles.button, group.id === groupId && styles.choiceSelected]}
                >
                  <Text
                    style={[styles.buttonText, group.id === groupId && styles.choiceSelectedText]}
                  >
                    {group.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            {recording.error ? <Text accessibilityRole="alert">{recording.error}</Text> : null}
            {recording.activeId ? (
              <View style={styles.card}>
                <Text accessibilityLiveRegion="polite">
                  {t(recording.isRecording ? 'recording.capturing' : 'recording.paused')} ·{' '}
                  {Math.floor(recording.durationMs / 1000)} s
                </Text>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={recording.busy}
                    style={styles.button}
                    onPress={() =>
                      void (recording.isRecording ? recording.pause() : recording.resume()).catch(
                        (reason) =>
                          Alert.alert(t('recording.operationFailed'), recordingError(reason, t)),
                      )
                    }
                  >
                    <Text>{t(recording.isRecording ? 'recording.pause' : 'recording.resume')}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={recording.busy}
                    style={styles.button}
                    onPress={() =>
                      void recording
                        .stop()
                        .catch((reason) =>
                          Alert.alert(t('recording.operationFailed'), recordingError(reason, t)),
                        )
                    }
                  >
                    <Text>{t('recording.finish')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={recording.busy}
                onPress={() => void recording.start(getApiUrl(), sourceId)}
                style={styles.button}
              >
                <Text>{t('recording.start')}</Text>
              </Pressable>
            )}
            <Text style={styles.hint}>{t('recording.backgroundRecording')}</Text>
            {drafts
              .filter((draft) => draft.state !== 'recording')
              .map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  sourceId={sourceId}
                  groupId={groupId}
                  mode={mode}
                />
              ))}
          </>
        )}
      </ScrollView>
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
    <View style={styles.card}>
      <Text accessibilityRole="header">{t('recording.pendingLocal')}</Text>
      <Text style={styles.hint}>{t('recording.localOnly')}</Text>
      {local.map((draft) => (
        <Pressable
          key={draft.id}
          accessibilityRole="button"
          style={styles.button}
          onPress={() =>
            router.push({
              pathname: '/recording',
              params: { sourceId, draftId: draft.id },
            } as unknown as Href)
          }
        >
          <Text>{draft.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radii.default,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: {
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radii.default,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonText: { ...typography.body, color: textColors.primary },
  choiceSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  choiceSelectedText: { color: colors.white },
  hint: { ...typography.description, color: textColors.secondary },
  input: {
    ...typography.body,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radii.default,
  },
});
