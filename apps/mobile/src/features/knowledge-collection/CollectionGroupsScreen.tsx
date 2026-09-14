/**
 * 知识收集分组选择页面。
 *
 * Responsibilities:
 * - 查询服务器分组并将关联分组优先展示。
 * - 保留搜索输入并提供失败重试。
 *
 * Notes:
 * - 不隐式选择分组，也不保存全局工作区状态。
 */
import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import type { GroupSummary } from '@echowave/contracts';
import { listGroups } from '@/shared/api/groupsApi';
import { listKnowledgeBaseGroups } from '@/shared/api/knowledgeBasesApi';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  CollectionButton,
  CollectionField,
  CollectionLayout,
  CollectionNavigationRow,
  styles,
} from './ui';

/** 在缺少明确分组上下文时由用户选择分组。 */
export function CollectionGroupsScreen({
  defaultKnowledgeId,
  onBack,
  onSelect,
}: {
  defaultKnowledgeId?: string;
  onBack: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useAppLanguage();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, associated] = await Promise.allSettled([
        listGroups(),
        defaultKnowledgeId
          ? listKnowledgeBaseGroups(defaultKnowledgeId)
          : Promise.resolve({ items: [] }),
      ]);
      if (all.status === 'rejected') throw all.reason;
      setGroups(all.value.items);
      // 默认库失效时仍允许选择分组，规则表单会保留并提示失效目标。
      setLinked(
        new Set(
          associated.status === 'fulfilled' ? associated.value.items.map((group) => group.id) : [],
        ),
      );
      setError(associated.status === 'rejected' ? t('collection.targetUnavailable') : '');
    } catch {
      setError(t('collection.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [defaultKnowledgeId, t]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  const visible = groups
    .filter((group) => group.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)));
  return (
    <CollectionLayout
      title={t('collection.selectGroup')}
      onBack={onBack}
      loading={loading}
      error={error}
      onRetry={() => void load()}
      onRefresh={load}
    >
      <CollectionField label={t('collection.searchGroups')} value={query} onChange={setQuery} />
      {query ? (
        <CollectionButton label={t('collection.clearSearch')} onPress={() => setQuery('')} />
      ) : null}
      {!loading && !error && !visible.length ? (
        <Text style={styles.hint}>
          {t(groups.length ? 'collection.noMatches' : 'collection.noGroups')}
        </Text>
      ) : null}
      {visible.map((group) => (
        <CollectionNavigationRow
          key={group.id}
          title={group.name}
          description={linked.has(group.id) ? t('collection.linkedGroup') : undefined}
          onPress={() => onSelect(group.id)}
        />
      ))}
    </CollectionLayout>
  );
}
