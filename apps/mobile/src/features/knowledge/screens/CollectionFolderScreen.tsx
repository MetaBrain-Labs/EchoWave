/**
 * 规则文件夹内容与历史整理页面。
 *
 * Responsibilities:
 * - 通过原文档组件展示独立案例，保留根目录搜索条件。
 * - 按来源分组选择同库规则并逐项反馈归类结果。
 * Notes:
 * - 归类不改正文、审核状态、文档身份或媒体。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CollectionRule, GroupSummary, KnowledgeDocument } from '@echowave/contracts';
import { getCollectionFolder, organizeCollectionCases } from '@/shared/api/collectionFoldersApi';
import { listCollectionRules } from '@/shared/api/collectionApi';
import { listGroups } from '@/shared/api/groupsApi';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { PageHeader } from '@/shared/ui/PageHeader';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { FixedActionButton } from '@/shared/ui/FixedActionButton';
import { ActionSheet } from '@/shared/ui/ActionSheet';
import { textInputText } from '@/shared/theme/textInput';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { listDocuments } from '../apiClient';
import { KnowledgeCaseActions } from '../components/KnowledgeCaseActions';
import { DocumentRow } from './KnowledgeDetailScreen';

/** 目录正文使用服务器身份，网络失败保留选择和当前菜单。 */
export function CollectionFolderScreen({
  knowledgeId,
  folderId,
  initialQuery = '',
  organizing = false,
  onBack,
  onOpenCase,
  onViewRule,
  onOrganize,
}: {
  knowledgeId: string;
  folderId: string;
  initialQuery?: string;
  organizing?: boolean;
  onBack: () => void;
  onOpenCase: (id: string, editing?: boolean) => void;
  onViewRule: (groupId: string, ruleId: string) => void;
  onOrganize: () => void;
}) {
  const { t } = useAppLanguage();
  const [data, setData] = useState<Awaited<ReturnType<typeof getCollectionFolder>>>();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [rules, setRules] = useState<CollectionRule[]>([]);
  const [ruleId, setRuleId] = useState('');
  const [groupQuery, setGroupQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [caseMenu, setCaseMenu] = useState<string>();
  const [folderMenu, setFolderMenu] = useState(false);
  const load = useCallback(async () => {
    try {
      const [next, docs] = await Promise.all([
        getCollectionFolder(knowledgeId, folderId),
        listDocuments(knowledgeId),
      ]);
      setData(next);
      setDocuments(docs.items);
      setSelected(
        (current) =>
          new Set([...current].filter((id) => next.items.some((item) => item.caseId === id))),
      );
      setError('');
    } catch {
      setError(t('collection.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [knowledgeId, folderId, t]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  const refresh = useScreenRefresh(load);
  useEffect(() => {
    if (organizing)
      void listGroups()
        .then((result) => setGroups(result.items))
        .catch(() => setError(t('collection.loadFailed')));
  }, [organizing, t]);
  useEffect(() => {
    let active = true;
    if (groupId)
      void listCollectionRules(groupId)
        .then((result) => {
          if (active) setRules(result.items.filter((rule) => rule.knowledgeBaseId === knowledgeId));
        })
        .catch(() => {
          if (active) setError(t('collection.loadFailed'));
        });
    return () => {
      active = false;
    };
  }, [groupId, knowledgeId, t]);
  const organize = async () => {
    if (!data || !selected.size || !ruleId || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await organizeCollectionCases(knowledgeId, folderId, {
        ruleId,
        items: data.items
          .filter((item) => selected.has(item.caseId))
          .map((item) => ({ id: item.caseId, expectedVersion: item.version })),
      });
      await load();
      const failed = result.items.filter((item) => !item.success);
      setSelected(
        (current) => new Set([...current].filter((id) => failed.some((item) => item.id === id))),
      );
      if (failed.length) setError(t('collection.partialFailure', { count: failed.length }));
    } catch {
      setError(t('collection.menuFailure'));
    } finally {
      setBusy(false);
    }
  };
  const items =
    data?.items.filter(
      (item) =>
        (!organizing || item.groupId === groupId) &&
        (data.folder.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
          item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    ) ?? [];
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.header}>
        <PageHeader
          title={
            organizing
              ? t('collection.organize')
              : (data?.folder.name ?? t('collection.openFolderAction'))
          }
          onBack={onBack}
          onMore={!organizing ? () => setFolderMenu(true) : undefined}
        />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<ScreenRefreshControl {...refresh} />}
      >
        {loading ? <ActivityIndicator /> : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.meta}>
            {error}
          </Text>
        ) : null}
        {error ? (
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.action}>
            <Text style={styles.text}>{t('collection.readServerState')}</Text>
          </Pressable>
        ) : null}
        <TextInput
          accessibilityLabel={t('collection.search')}
          placeholder={t('collection.search')}
          value={query}
          onChangeText={setQuery}
          style={styles.input}
          placeholderTextColor={textColors.secondary}
        />
        {query ? (
          <Pressable accessibilityRole="button" onPress={() => setQuery('')} style={styles.action}>
            <Text style={styles.text}>{t('collection.clearSearch')}</Text>
          </Pressable>
        ) : null}
        {organizing ? (
          <View style={styles.card}>
            <Text style={styles.heading}>{t('collection.selectGroup')}</Text>
            <TextInput
              accessibilityLabel={t('collection.searchGroups')}
              value={groupQuery}
              onChangeText={setGroupQuery}
              style={styles.input}
            />
            {groups
              .filter(
                (group) =>
                  data?.items.some((item) => item.groupId === group.id) &&
                  group.name.toLocaleLowerCase().includes(groupQuery.toLocaleLowerCase()),
              )
              .map((group) => (
                <Pressable
                  key={group.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: groupId === group.id }}
                  onPress={() => {
                    setGroupId(group.id);
                    setRuleId('');
                    setRules([]);
                    setSelected(new Set());
                  }}
                  style={[styles.action, groupId === group.id && styles.selected]}
                >
                  <Text style={styles.text}>{group.name}</Text>
                </Pressable>
              ))}
            <Text style={styles.heading}>{t('collection.selectRule')}</Text>
            {rules.map((rule) => (
              <Pressable
                key={rule.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: ruleId === rule.id }}
                onPress={() => setRuleId(rule.id)}
                style={[styles.action, ruleId === rule.id && styles.selected]}
              >
                <Text style={styles.text}>{rule.name}</Text>
              </Pressable>
            ))}
            {groupId && !rules.length ? (
              <Text style={styles.meta}>{t('collection.noRules')}</Text>
            ) : null}
            {items.length ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelected(new Set(items.map((item) => item.caseId)))}
                style={styles.action}
              >
                <Text style={styles.text}>{t('collection.selectAll')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {!loading && !items.length ? (
          <Text style={styles.meta}>{t('collection.noMatches')}</Text>
        ) : null}
        {items.map((item) => {
          const document = documents.find((document) => document.id === item.documentId);
          return (
            <View key={item.caseId}>
              {organizing ? (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={t('collection.selectCase', { title: item.title })}
                  accessibilityState={{ checked: selected.has(item.caseId) }}
                  onPress={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(item.caseId)) next.delete(item.caseId);
                      else next.add(item.caseId);
                      return next;
                    })
                  }
                  style={[styles.action, selected.has(item.caseId) && styles.selected]}
                >
                  <Text style={styles.text}>
                    {selected.has(item.caseId) ? '☑' : '☐'} {item.title}
                  </Text>
                </Pressable>
              ) : document ? (
                <DocumentRow
                  document={document}
                  onOpen={() => onOpenCase(item.caseId)}
                  onMore={() => setCaseMenu(item.caseId)}
                />
              ) : (
                <View style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onOpenCase(item.caseId)}
                    style={styles.copy}
                  >
                    <Text style={styles.heading}>{item.title}</Text>
                    <Text style={styles.meta}>{t('collection.pending')}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('knowledgeDetail.fileActions', { title: item.title })}
                    onPress={() => setCaseMenu(item.caseId)}
                    style={styles.action}
                  >
                    <Text style={styles.text}>⋮</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      {organizing ? (
        <View style={styles.footer}>
          <FixedActionButton
            emphasized
            icon="albums-outline"
            label={`${t('collection.organize')} (${selected.size})`}
            disabled={busy || !selected.size || !ruleId}
            onPress={() => void organize()}
          />
        </View>
      ) : null}
      {caseMenu ? (
        <KnowledgeCaseActions
          caseId={caseMenu}
          onClose={() => setCaseMenu(undefined)}
          onOpen={(editing) => onOpenCase(caseMenu, editing)}
          onChanged={load}
        />
      ) : null}
      <ActionSheet
        visible={folderMenu}
        title={data?.folder.name ?? ''}
        closeLabel={t('collection.cancel')}
        onClose={() => setFolderMenu(false)}
        actions={[
          ...(data?.folder.kind === 'rule'
            ? [
                {
                  label: t('collection.viewRule'),
                  icon: 'options-outline' as const,
                  onPress: () => {
                    onViewRule(data.folder.groupId!, data.folder.ruleId!);
                    setFolderMenu(false);
                  },
                },
              ]
            : []),
          ...(data?.folder.kind === 'legacy'
            ? [
                {
                  label: t('collection.organize'),
                  icon: 'albums-outline' as const,
                  onPress: () => {
                    onOrganize();
                    setFolderMenu(false);
                  },
                },
              ]
            : []),
        ]}
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  content: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radii.default,
  },
  input: {
    ...textInputText,
    height: 44,
    paddingHorizontal: spacing.sm,
    includeFontPadding: false,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radii.default,
    ...typography.body,
    fontFamily: fontFamilies.sans,
    color: textColors.primary,
  },
  text: { ...typography.body, fontFamily: fontFamilies.sans, color: textColors.primary },
  heading: {
    ...typography.heading3,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    color: textColors.primary,
  },
  meta: { ...typography.description, fontFamily: fontFamilies.sans, color: textColors.secondary },
  action: {
    minHeight: 44,
    backgroundColor: colors.card,
    justifyContent: 'center',
    padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: radii.default,
  },
  selected: { backgroundColor: colors.successSurface, borderColor: colors.success },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  copy: { flex: 1 },
  footer: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: spacing.md,
    flexDirection: 'row',
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.card,
  },
});
