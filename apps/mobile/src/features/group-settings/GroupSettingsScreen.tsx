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
import { useCallback, useEffect, useState } from 'react';
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
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

type SettingsTab = 'basic' | 'knowledge' | 'sources';
const tabs: { key: SettingsTab; label: string }[] = [
  { key: 'basic', label: '基本设置' },
  { key: 'knowledge', label: '知识库设置' },
  { key: 'sources', label: '数据源设置' },
];
const toneShortcuts = ['简单直接', '正式、专业', '结构清晰', '亲和温暖'];

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

  const load = useCallback(async () => {
    setLoading(true);
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
      setName(settings.name);
      setTiming(settings.analysis.timing);
      setContentFocus(settings.analysis.contentFocus);
      setTone(settings.analysis.tone);
      setCustomTags(settings.analysis.customTags);
      setKnowledgeBases(allKnowledge.items);
      setSelectedKnowledgeIds(new Set(linkedKnowledge.items.map((item) => item.id)));
      setDataSources(allSources.items);
      setSelectedSourceIds(new Set(linkedSources.items.map((item) => item.id)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '分组设置加载失败。');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const toggle = (setter: typeof setSelectedKnowledgeIds, id: string) => {
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
        '无法新增标签',
        value.length > 24 ? '标签最多 24 个字。' : '最多设置 12 个标签。',
      );
      return;
    }
    setCustomTags((current) => [...current, value]);
    setTagDraft('');
  };

  const saveBasic = async () => {
    if (!name.trim() || !contentFocus.trim() || !tone.trim()) {
      Alert.alert('无法保存', '分组名称、内容侧重和语气风格不能为空。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateGroupSettings(groupId, {
        name,
        analysis: { timing, contentFocus, tone, customTags },
      });
      Alert.alert('保存成功', '分组分析设置已更新。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '设置保存失败。');
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
        '保存成功',
        activeTab === 'knowledge' ? '知识库关联已更新。' : '数据源关联已更新。',
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '关联保存失败。');
    } finally {
      setSaving(false);
    }
  };

  const confirmArchive = () => {
    Alert.alert('归档分组？', '归档后分组将从主界面隐藏，已有音频和分析结果仍会保留。', [
      { text: '取消', style: 'cancel' },
      {
        text: '归档分组',
        style: 'destructive',
        onPress: () => {
          setSaving(true);
          void archiveGroup(groupId)
            .then(onArchived)
            .catch((reason) =>
              setError(reason instanceof Error ? reason.message : '分组归档失败。'),
            )
            .finally(() => setSaving(false));
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.headerButton}>
          <Ionicons color={colors.ink} name="chevron-back" size={32} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.headerTitle}>
          分组设置
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
          accessibilityLabel="正在加载分组设置"
          color={colors.ink}
          style={styles.loading}
        />
      ) : error && !name ? (
        <View style={styles.emptyState}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error}
          </Text>
          <Pressable onPress={() => void load()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>重新加载</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {activeTab === 'basic' ? (
            <>
              <Text style={styles.sectionTitle}>分组信息</Text>
              <Text style={styles.label}>分组名称</Text>
              <TextInput
                accessibilityLabel="分组名称"
                maxLength={120}
                onChangeText={setName}
                placeholder="分组名称"
                style={styles.input}
                value={name}
              />
              <Text style={styles.sectionTitle}>分析配置</Text>
              <Text style={styles.label}>分析时间</Text>
              <View style={styles.optionRow}>
                {(['automatic', 'manual'] as const).map((value) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: timing === value }}
                    key={value}
                    onPress={() => setTiming(value)}
                    style={[styles.option, timing === value && styles.optionActive]}
                  >
                    <Text style={styles.optionText}>
                      {value === 'automatic' ? '确认后自动' : '手动分析'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>内容侧重</Text>
              <Text style={styles.hint}>在基础分析上，增强有关内容的分析侧重点</Text>
              <TextInput
                accessibilityLabel="内容侧重"
                maxLength={4_000}
                multiline
                onChangeText={setContentFocus}
                style={[styles.input, styles.largeInput]}
                textAlignVertical="top"
                value={contentFocus}
              />
              <Text style={styles.label}>语气风格</Text>
              <Text style={styles.hint}>期望生成的报告措辞风格</Text>
              <TextInput
                accessibilityLabel="语气风格"
                maxLength={1_000}
                multiline
                onChangeText={setTone}
                style={[styles.input, styles.mediumInput]}
                textAlignVertical="top"
                value={tone}
              />
              <View style={styles.chips}>
                {toneShortcuts.map((shortcut) => (
                  <Pressable key={shortcut} onPress={() => setTone(shortcut)} style={styles.chip}>
                    <Text style={styles.chipText}>{shortcut}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>分析标签</Text>
              <Text style={styles.hint}>在基础分析中，增加自定义分析维度</Text>
              <View style={styles.chips}>
                {customTags.map((tag) => (
                  <Pressable
                    accessibilityLabel={`删除分析标签：${tag}`}
                    key={tag}
                    onPress={() =>
                      setCustomTags((current) => current.filter((item) => item !== tag))
                    }
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>{tag} ×</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.addTagRow}>
                <TextInput
                  accessibilityLabel="新分析标签"
                  maxLength={24}
                  onChangeText={setTagDraft}
                  onSubmitEditing={addTag}
                  placeholder="输入新标签"
                  style={[styles.input, styles.addTagInput]}
                  value={tagDraft}
                />
                <Pressable onPress={addTag} style={styles.addTagButton}>
                  <Text style={styles.addTagText}>＋ 新增</Text>
                </Pressable>
              </View>
              <Pressable
                disabled={saving}
                onPress={() => void saveBasic()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>{saving ? '正在保存…' : '保存设置'}</Text>
              </Pressable>
              <Text style={styles.sectionTitle}>分组操作</Text>
              <Pressable disabled={saving} onPress={confirmArchive} style={styles.archiveButton}>
                <Ionicons color={colors.white} name="archive-outline" size={22} />
                <Text style={styles.archiveText}>归档分组</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>
                {activeTab === 'knowledge' ? '关联知识库' : '关联数据源'}
              </Text>
              <Text style={styles.hint}>
                {activeTab === 'knowledge'
                  ? '业务分析只能检索此处保存的知识库。'
                  : '解除关联不会删除数据源或其中的音频。'}
              </Text>
              {(activeTab === 'knowledge' ? knowledgeBases : dataSources).length === 0 ? (
                <Text style={styles.emptyText}>暂无可关联内容。</Text>
              ) : activeTab === 'knowledge' ? (
                knowledgeBases.map((item) => (
                  <ToggleRow
                    checked={selectedKnowledgeIds.has(item.id)}
                    description={`${item.documentCount} 个文档 · ${item.description || '暂无说明'}`}
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
                <Text style={styles.primaryButtonText}>{saving ? '正在保存…' : '保存关联'}</Text>
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
