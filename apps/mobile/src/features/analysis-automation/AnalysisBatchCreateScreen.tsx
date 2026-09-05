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
} from '@echowave/contracts';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';

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
  const [sources, setSources] = useState<DataSourceSummary[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [groups, setGroups] = useState<LinkedDataSourceGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [audioFiles, setAudioFiles] = useState<AudioFileSummary[]>([]);
  const [selectedAudioIds, setSelectedAudioIds] = useState<string[]>([]);
  const [assets, setAssets] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [sourceKind, setSourceKind] = useState<'uploads' | 'existing_audio'>('uploads');
  const [scheduled, setScheduled] = useState(false);
  const [scheduledText, setScheduledText] = useState('');
  const [runtimeMode, setRuntimeMode] = useState('');
  const [preview, setPreview] = useState('选择分组后显示冻结配置');
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
        Alert.alert('加载失败', error instanceof Error ? error.message : '请稍后重试。'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!sourceId) return;
    void Promise.all([listDataSourceGroups(sourceId), listDataSourceAudioFiles(sourceId)])
      .then(([groupResponse, audioResponse]) => {
        setGroups(groupResponse.items);
        setGroupId(groupResponse.items[0]?.id ?? '');
        setAudioFiles(audioResponse.items);
      })
      .catch((error) =>
        Alert.alert('加载失败', error instanceof Error ? error.message : '请稍后重试。'),
      );
  }, [sourceId]);

  useEffect(() => {
    if (!groupId) return;
    void getGroupSettings(groupId)
      .then((settings) =>
        setPreview(
          `重点：${settings.analysis.contentFocus}\n语气：${settings.analysis.tone}\n标签：${settings.analysis.customTags.join('、') || '无'}`,
        ),
      )
      .catch(() => setPreview('配置预览暂时不可用，服务端仍会在入队时冻结。'));
  }, [groupId]);

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
        setPreview('选择分组后显示冻结配置');
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
          return audio ? existingAudioDisabledReason(audio, runtime.mode) === null : false;
        }),
      );
      if (nextGroupId) {
        const settings = await getGroupSettings(nextGroupId);
        setPreview(
          `重点：${settings.analysis.contentFocus}\n语气：${settings.analysis.tone}\n标签：${settings.analysis.customTags.join('、') || '无'}`,
        );
      } else {
        setPreview('选择分组后显示冻结配置');
      }
      setRefreshError('');
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : '刷新失败，请稍后重试。');
    }
  }, [groupId, sourceId]);
  const screenRefresh = useScreenRefresh(refreshPage);

  const selectedCount = sourceKind === 'uploads' ? assets.length : selectedAudioIds.length;
  const incompatibility = useMemo(
    () =>
      scheduled && runtimeMode === 'lightweight_local'
        ? '轻量本地模式不支持定时分析，请改为立即执行。'
        : null,
    [runtimeMode, scheduled],
  );

  async function pickFiles() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      multiple: true,
      copyToCacheDirectory: false,
    });
    if (!result.canceled) setAssets(result.assets.slice(0, 20));
  }

  function selectSource(id: string) {
    setSourceId(id);
    setGroupId('');
    setSelectedAudioIds([]);
    setPreview('选择分组后显示冻结配置');
  }

  function scheduledFor(): string | null {
    if (!scheduled) return null;
    const date = new Date(scheduledText.trim().replace(' ', 'T'));
    if (!scheduledText.trim() || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      throw new Error('请输入晚于当前时间的本地时间，例如 2026-09-05 09:30。');
    }
    return date.toISOString();
  }

  async function submit() {
    if (!sourceId || !groupId || selectedCount < 1 || selectedCount > 20 || incompatibility) {
      Alert.alert('无法创建', incompatibility ?? '请选择数据源、分组和 1 至 20 个音频。');
      return;
    }
    setSubmitting(true);
    try {
      const common = { dataSourceId: sourceId, groupId, scheduledFor: scheduledFor(), pipeline };
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
      Alert.alert('创建失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading)
    return (
      <SafeAreaView style={styles.page}>
        <TopLevelPageHeader
          subtitle="上传后由服务器自动完成转写、情绪、角色和业务分析"
          title="一键分析"
        />
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.page}>
      <TopLevelPageHeader
        subtitle="上传后由服务器自动完成转写、情绪、角色和业务分析"
        title="一键分析"
      />
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<ScreenRefreshControl {...screenRefresh} />}
      >
        {refreshError ? (
          <Text accessibilityRole="alert" style={styles.danger}>
            刷新失败：{refreshError}
          </Text>
        ) : null}
        <Section title="1. 数据源">
          <ChoiceRow
            items={sources.map((item) => ({ id: item.id, label: item.name }))}
            selected={sourceId}
            onSelect={selectSource}
          />
        </Section>
        <Section title="2. 分组（单选）">
          {groups.length ? (
            <ChoiceRow
              items={groups.map((item) => ({ id: item.id, label: item.name }))}
              selected={groupId}
              onSelect={setGroupId}
            />
          ) : (
            <Text style={styles.hint}>当前数据源尚未关联分组。</Text>
          )}
        </Section>
        <Section title="3. 音频">
          <ChoiceRow
            items={[
              { id: 'uploads', label: '新上传' },
              { id: 'existing_audio', label: '已有音频' },
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
              <Text style={styles.buttonText}>选择多个音频（{assets.length}/20）</Text>
            </Pressable>
          ) : (
            <View style={styles.list}>
              {audioFiles.map((audio) => {
                const selected = selectedAudioIds.includes(audio.id);
                const disabledReason = existingAudioDisabledReason(audio, runtimeMode);
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
                      <Text style={styles.hint}>{audio.runtimeMode ?? '模式未知'}</Text>
                      {disabledReason ? <Text style={styles.danger}>{disabledReason}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Section>
        <Section title="4. 执行时间">
          <ChoiceRow
            items={[
              { id: 'now', label: '立即执行' },
              { id: 'later', label: '指定时间' },
            ]}
            selected={scheduled ? 'later' : 'now'}
            onSelect={(id) => setScheduled(id === 'later')}
          />
          {scheduled ? (
            <TextInput
              accessibilityLabel="计划执行时间"
              onChangeText={setScheduledText}
              placeholder="本地时间：2026-09-05 09:30"
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
            本批次冻结模式：{runtimeMode || '未知'}
            。文件上传与校验立即进行，模型阶段在计划时间后开始。
          </Text>
        </Section>
        <Section title="5. 冻结配置预览">
          <Text style={styles.preview}>{preview}</Text>
          <Text style={styles.hint}>
            知识库、模型能力绑定和阶段开关会随批次保存；后续设置变化不影响已入队任务。
          </Text>
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
            <Text style={styles.primaryText}>上传并开始全流程</Text>
          )}
        </Pressable>
        {recentBatches.length ? (
          <Section title="最近批次">
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
                    {new Date(batch.createdAt).toLocaleString()} · 完成 {batch.counts.completed} ·
                    警告 {batch.counts.partial} · 失败 {batch.counts.failed}
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

function existingAudioDisabledReason(audio: AudioFileSummary, runtimeMode: string): string | null {
  if (!runtimeMode) return '正在读取当前运行模式';
  if (audio.runtimeMode !== runtimeMode)
    return `当前为 ${audio.runtimeMode ?? '未知'}，需切换运行模式`;
  if (
    runtimeMode === 'lightweight_local' &&
    pipeline.includeEmotion &&
    audio.sourceState !== 'available' &&
    !audio.acousticEmotionReady
  ) {
    return '需重新挂载原文件';
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
  selected,
  onSelect,
}: {
  items: { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.choices}>
      {items.map((item) => (
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
    borderRadius: radii.round,
    borderWidth: 1,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  choiceSelected: { backgroundColor: colors.successSurface, borderColor: colors.success },
  choiceText: { ...typography.body, color: textColors.primary },
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
