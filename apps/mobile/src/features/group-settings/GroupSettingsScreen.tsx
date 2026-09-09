/**
 * 分组设置页面。
 *
 * 按产品原型提供基本分析配置、知识库关联和数据源关联三个页签，所有保存操作通过
 * 服务端权威设置与事务关联接口完成。
 *
 * Responsibilities:
 * - 编辑分组名称、分析时机、内容侧重、语气风格与自定义标签。
 * - 查看并原子替换分组的知识库和数据源关联。
 * - 执行带二次确认的分组归档。
 *
 * Notes:
 * - 页面不在设备存储中复制服务器设置。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  DEFAULT_GROUP_ANALYSIS_FOCUS,
  DEFAULT_GROUP_ANALYSIS_TONE,
  type DataSourceSummary,
  type GroupAnalysisTiming,
  type KnowledgeBaseSummary,
} from '@echowave/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  archiveGroup,
  getGroupSettings,
  listGroupDataSources,
  listGroupKnowledgeBases,
  replaceGroupDataSources,
  replaceGroupKnowledgeBases,
  updateGroupSettings,
} from '@/shared/api/groupsApi';
import { listDataSources } from '@/shared/api/dataSourcesApi';
import { listKnowledgeBases } from '@/shared/api/knowledgeBasesApi';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

type SettingsTab = 'basic' | 'knowledge' | 'sources';

function ToggleRow({
  checked,
  description,
  label,
  onPress,
}: {
  checked: boolean;
  description: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={({ pressed }) => [styles.resourceRow, pressed && styles.pressed]}
    >
      <View style={styles.resourceCopy}>
        <Text style={styles.resourceTitle}>{label}</Text>
        <Text numberOfLines={2} style={styles.resourceDescription}>
          {description}
        </Text>
      </View>
      <Ionicons
        color={checked ? colors.ink : colors.secondary}
        name={checked ? 'checkbox' : 'square-outline'}
        size={24}
      />
    </Pressable>
  );
}

/** 渲染指定分组的三页签设置表单。 */
export function GroupSettingsScreen({
  groupId,
  onArchived,
  onBack,
}: {
  groupId: string;
  onArchived: () => void;
  onBack: () => void;
}) {
  const { formatNumber, t } = useAppLanguage();
  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'basic', label: t('groupSettings.tabBasic') },
    { key: 'knowledge', label: t('groupSettings.tabKnowledge') },
    { key: 'sources', label: t('groupSettings.tabSources') },
  ];
  const toneShortcuts = [
    t('groupSettings.toneDirect'),
    t('groupSettings.toneFormal'),
    t('groupSettings.toneStructured'),
    t('groupSettings.toneWarm'),
  ];
  const [activeTab, setActiveTab] = useState<SettingsTab>('basic');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [timing, setTiming] = useState<GroupAnalysisTiming>('automatic');
  const [contentFocus, setContentFocus] = useState(DEFAULT_GROUP_ANALYSIS_FOCUS);
  const [tone, setTone] = useState(DEFAULT_GROUP_ANALYSIS_TONE);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [selectedKnowledgeIds, setSelectedKnowledgeIds] = useState<Set<string>>(() => new Set());
  const [dataSources, setDataSources] = useState<DataSourceSummary[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set());
  const runInitialRequest = useInitialRequestLoading();
  const dirtyRef = useRef(false);

  const load = useCallback(
    async (preserveDraft = false) => {
      if (!preserveDraft) setLoading(true);
      setError('');
      try {
        const [settings, allKnowledge, linkedKnowledge, allSources, linkedSources] =
          await Promise.all([
            getGroupSettings(groupId),
            listKnowledgeBases(),
            listGroupKnowledgeBases(groupId),
            listDataSources(),
            listGroupDataSources(groupId),
          ]);
        setKnowledgeBases(allKnowledge.items);
        setDataSources(allSources.items);
        if (!preserveDraft || !dirtyRef.current) {
          setName(settings.name);
          setTiming(settings.analysis.timing);
          setContentFocus(settings.analysis.contentFocus);
          setTone(settings.analysis.tone);
          setCustomTags(settings.analysis.customTags);
          setSelectedKnowledgeIds(new Set(linkedKnowledge.items.map((item) => item.id)));
          setSelectedSourceIds(new Set(linkedSources.items.map((item) => item.id)));
          dirtyRef.current = false;
        } else {
          const validKnowledgeIds = new Set(allKnowledge.items.map((item) => item.id));
          const validSourceIds = new Set(allSources.items.map((item) => item.id));
          setSelectedKnowledgeIds(
            (current) => new Set([...current].filter((id) => validKnowledgeIds.has(id))),
          );
          setSelectedSourceIds(
            (current) => new Set([...current].filter((id) => validSourceIds.has(id))),
          );
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('groupSettings.loadFailed'));
      } finally {
        if (!preserveDraft) setLoading(false);
      }
    },
    [groupId, t],
  );
  const screenRefresh = useScreenRefresh(() => load(true));

  useEffect(() => {
    const task = setTimeout(() => void runInitialRequest(load), 0);
    return () => clearTimeout(task);
  }, [load, runInitialRequest]);

  const toggle = (setter: typeof setSelectedKnowledgeIds, id: string) => {
    dirtyRef.current = true;
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addTag = () => {
    const value = tagDraft.trim();
    if (!value || customTags.includes(value)) {
      setTagDraft('');
      return;
    }
    if (value.length > 24 || customTags.length >= 12) {
      Alert.alert(
        t('groupSettings.tagUnavailable'),
        value.length > 24 ? t('groupSettings.tagLength') : t('groupSettings.tagLimit'),
      );
      return;
    }
    setCustomTags((current) => [...current, value]);
    dirtyRef.current = true;
    setTagDraft('');
  };

  const saveBasic = async () => {
    if (!name.trim() || !contentFocus.trim() || !tone.trim()) {
      Alert.alert(t('groupSettings.cannotSave'), t('groupSettings.required'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateGroupSettings(groupId, {
        name,
        analysis: { timing, contentFocus, tone, customTags },
      });
      Alert.alert(t('groupSettings.saved'), t('groupSettings.settingsUpdated'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('groupSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const saveLinks = async () => {
    setSaving(true);
    setError('');
    try {
      if (activeTab === 'knowledge') {
        await replaceGroupKnowledgeBases(groupId, { ids: [...selectedKnowledgeIds] });
      } else {
        await replaceGroupDataSources(groupId, { ids: [...selectedSourceIds] });
      }
      Alert.alert(
        t('groupSettings.saved'),
        activeTab === 'knowledge'
          ? t('groupSettings.knowledgeUpdated')
          : t('groupSettings.sourcesUpdated'),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('groupSettings.linksFailed'));
    } finally {
      setSaving(false);
    }
  };

  const confirmArchive = () => {
    Alert.alert(t('groupSettings.archiveTitle'), t('groupSettings.archiveBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('groupSettings.archive'),
        style: 'destructive',
        onPress: () => {
          setSaving(true);
          void archiveGroup(groupId)
            .then(onArchived)
            .catch((reason) =>
              setError(reason instanceof Error ? reason.message : t('groupSettings.archiveFailed')),
            )
            .finally(() => setSaving(false));
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          style={styles.headerButton}
        >
          <Ionicons color={colors.ink} name="chevron-back" size={32} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.headerTitle}>
          {t('groupSettings.title')}
        </Text>
        <View style={styles.headerButton} />
      </View>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {tabs.map((tab) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.key }}
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={styles.tab}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
            {activeTab === tab.key ? <View style={styles.tabLine} /> : null}
          </Pressable>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator
          accessibilityLabel={t('groupSettings.loading')}
          color={colors.ink}
          style={styles.loading}
        />
      ) : error && !name ? (
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.emptyState}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        >
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error}
          </Text>
          <Pressable onPress={() => void load()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{t('groupSettings.reload')}</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
          showsVerticalScrollIndicator={false}
          testID="group-settings-scroll"
        >
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {activeTab === 'basic' ? (
            <>
              <Text style={styles.sectionTitle}>{t('groupSettings.groupInfo')}</Text>
              <Text style={styles.label}>{t('groupSettings.groupName')}</Text>
              <TextInput
                accessibilityLabel={t('groupSettings.groupName')}
                maxLength={120}
                onChangeText={(value) => {
                  setName(value);
                  dirtyRef.current = true;
                }}
                placeholder={t('groupSettings.groupName')}
                style={styles.input}
                value={name}
              />
              <Text style={styles.sectionTitle}>{t('groupSettings.analysisConfig')}</Text>
              <Text style={styles.label}>{t('groupSettings.analysisTiming')}</Text>
              <View style={styles.optionRow}>
                {(['automatic', 'manual'] as const).map((value) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: timing === value }}
                    key={value}
                    onPress={() => {
                      setTiming(value);
                      dirtyRef.current = true;
                    }}
                    style={[styles.option, timing === value && styles.optionActive]}
                  >
                    <Text style={styles.optionText}>
                      {value === 'automatic'
                        ? t('groupSettings.automatic')
                        : t('groupSettings.manual')}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>{t('groupSettings.contentFocus')}</Text>
              <Text style={styles.hint}>{t('groupSettings.contentFocusHint')}</Text>
              <TextInput
                accessibilityLabel={t('groupSettings.contentFocus')}
                maxLength={4_000}
                multiline
                onChangeText={(value) => {
                  setContentFocus(value);
                  dirtyRef.current = true;
                }}
                style={[styles.input, styles.largeInput]}
                textAlignVertical="top"
                value={contentFocus}
              />
              <Text style={styles.label}>{t('groupSettings.tone')}</Text>
              <Text style={styles.hint}>{t('groupSettings.toneHint')}</Text>
              <TextInput
                accessibilityLabel={t('groupSettings.tone')}
                maxLength={1_000}
                multiline
                onChangeText={(value) => {
                  setTone(value);
                  dirtyRef.current = true;
                }}
                style={[styles.input, styles.mediumInput]}
                textAlignVertical="top"
                value={tone}
              />
              <View style={styles.chips}>
                {toneShortcuts.map((shortcut) => (
                  <Pressable
                    key={shortcut}
                    onPress={() => {
                      setTone(shortcut);
                      dirtyRef.current = true;
                    }}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>{shortcut}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>{t('groupSettings.analysisTags')}</Text>
              <Text style={styles.hint}>{t('groupSettings.analysisTagsHint')}</Text>
              <View style={styles.chips}>
                {customTags.map((tag) => (
                  <Pressable
                    accessibilityLabel={t('groupSettings.removeTag', { tag })}
                    key={tag}
                    onPress={() => {
                      setCustomTags((current) => current.filter((item) => item !== tag));
                      dirtyRef.current = true;
                    }}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>{tag} ×</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.addTagRow}>
                <TextInput
                  accessibilityLabel={t('groupSettings.newTag')}
                  maxLength={24}
                  onChangeText={setTagDraft}
                  onSubmitEditing={addTag}
                  placeholder={t('groupSettings.newTagPlaceholder')}
                  style={[styles.input, styles.addTagInput]}
                  value={tagDraft}
                />
                <Pressable onPress={addTag} style={styles.addTagButton}>
                  <Text style={styles.addTagText}>{t('groupSettings.add')}</Text>
                </Pressable>
              </View>
              <Pressable
                disabled={saving}
                onPress={() => void saveBasic()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>
                  {saving ? t('sourceForm.saving') : t('groupSettings.saveSettings')}
                </Text>
              </Pressable>
              <Text style={styles.sectionTitle}>{t('groupSettings.groupActions')}</Text>
              <Pressable disabled={saving} onPress={confirmArchive} style={styles.archiveButton}>
                <Ionicons color={colors.white} name="archive-outline" size={22} />
                <Text style={styles.archiveText}>{t('groupSettings.archive')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>
                {activeTab === 'knowledge'
                  ? t('groupSettings.linkKnowledge')
                  : t('groupSettings.linkSources')}
              </Text>
              <Text style={styles.hint}>
                {activeTab === 'knowledge'
                  ? t('groupSettings.knowledgeHint')
                  : t('groupSettings.sourceHint')}
              </Text>
              {(activeTab === 'knowledge' ? knowledgeBases : dataSources).length === 0 ? (
                <Text style={styles.emptyText}>{t('groupSettings.empty')}</Text>
              ) : activeTab === 'knowledge' ? (
                knowledgeBases.map((item) => (
                  <ToggleRow
                    checked={selectedKnowledgeIds.has(item.id)}
                    description={t('groupSettings.documentCount', {
                      count: formatNumber(item.documentCount),
                      description: item.description || t('groupSettings.noDescription'),
                    })}
                    key={item.id}
                    label={item.name}
                    onPress={() => toggle(setSelectedKnowledgeIds, item.id)}
                  />
                ))
              ) : (
                dataSources.map((item) => (
                  <ToggleRow
                    checked={selectedSourceIds.has(item.id)}
                    description={item.description || item.connectionLabel}
                    key={item.id}
                    label={item.name}
                    onPress={() => toggle(setSelectedSourceIds, item.id)}
                  />
                ))
              )}
              <Pressable
                disabled={saving}
                onPress={() => void saveLinks()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>
                  {saving ? t('sourceForm.saving') : t('groupSettings.saveLinks')}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: spacing.sm,
  },
  headerButton: { alignItems: 'center', justifyContent: 'center', minHeight: 48, width: 48 },
  headerTitle: {
    ...typography.heading2,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  tabs: { flexDirection: 'row', paddingHorizontal: spacing.md },
  tab: { marginRight: spacing.lg, paddingBottom: spacing.xs, paddingTop: spacing.md },
  tabText: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sansBold },
  tabTextActive: { color: textColors.primary, fontWeight: 'bold' },
  tabLine: { backgroundColor: colors.ink, height: 2, marginTop: spacing.xs },
  loading: { marginTop: spacing.xxl },
  content: { paddingBottom: spacing.xxl, paddingHorizontal: spacing.md },
  sectionTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginBottom: spacing.md,
    marginTop: spacing.xl,
  },
  label: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.md,
  },
  hint: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  largeInput: { minHeight: 220 },
  mediumInput: { minHeight: 160 },
  optionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  option: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    padding: spacing.sm,
  },
  optionActive: { backgroundColor: colors.background, borderColor: colors.ink },
  optionText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipText: { ...typography.description, color: textColors.primary, fontFamily: fontFamilies.sans },
  addTagRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  addTagInput: { flex: 1 },
  addTagButton: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  addTagText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    marginTop: spacing.xl,
    minHeight: 52,
    justifyContent: 'center',
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  archiveButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 52,
  },
  archiveText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  resourceRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 72,
    paddingVertical: spacing.sm,
  },
  resourceCopy: { flex: 1, paddingRight: spacing.sm },
  resourceTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  resourceDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  errorText: {
    ...typography.description,
    color: colors.danger,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.md,
  },
  emptyState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.md },
  emptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xl,
  },
  secondaryButton: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  secondaryButtonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  pressed: { backgroundColor: colors.background },
});
