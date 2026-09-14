/**
 * 知识库案例与待审核列表。
 *
 * 展示正式学习案例和候选，提供带版本的批量精选或拒绝。
 *
 * Responsibilities:
 * - 将部分操作失败逐项反馈。
 * - 通过刷新查询服务器权威状态。
 *
 * Notes:
 * - 类别本身不代表质量认证。
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import type { KnowledgeCase } from '@echowave/contracts';
import { batchCaseActions, listKnowledgeCases } from '@/shared/api/collectionApi';
import { PageTabs } from '@/shared/ui/PageTabs';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';
import { CollectionButton, CollectionCheck, CollectionField, CollectionLayout, styles } from './ui';

/** 列表默认展示正式案例，用户可进入待审核和历史状态。 */
export function KnowledgeCasesScreen({
  knowledgeId,
  onBack,
  onOpen,
}: {
  knowledgeId: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  guideDemo?: boolean;
}) {
  const { t } = useAppLanguage();
  const casesTargetRef = useStarterTourTarget('collection-cases');
  const [items, setItems] = useState<KnowledgeCase[]>([]);
  const [tab, setTab] = useState<'published' | 'candidate' | 'history'>('published');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const next = (await listKnowledgeCases(knowledgeId)).items;
      setItems(next);
      setSelected(
        (current) =>
          new Set(
            [...current].filter((id) =>
              next.some((item) => item.id === id && item.status === 'candidate'),
            ),
          ),
      );
      setError('');
    } catch {
      setError(t('collection.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [knowledgeId, t]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  const batch = async (action: 'publish' | 'reject') => {
    setBusy(true);
    setError('');
    try {
      const result = await batchCaseActions(
        items
          .filter((v) => selected.has(v.id) && v.status === 'candidate')
          .map((v) => ({ id: v.id, expectedVersion: v.version, action })),
      );
      await load();
      const failures = result.items.filter((v) => !v.success);
      setSelected(
        (current) => new Set([...current].filter((id) => failures.some((item) => item.id === id))),
      );
      if (failures.length) setError(t('collection.partialFailure', { count: failures.length }));
    } catch {
      setError(t('collection.saveFailed'));
    } finally {
      setBusy(false);
    }
  };
  const visible = items.filter(
    (v) =>
      (tab === 'history' ? ['rejected', 'withdrawn'].includes(v.status) : v.status === tab) &&
      [v.content.title, v.content.reason, v.content.category.name]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <CollectionLayout
      title={t('collection.cases')}
      onBack={onBack}
      loading={loading}
      error={error}
      onRetry={() => void load()}
      onRefresh={load}
    >
      <View collapsable={false} ref={casesTargetRef}>
        <PageTabs
          activeTab={tab}
          onChange={(value) => {
            setTab(value);
            setPage(1);
            setSelected(new Set());
          }}
          tabs={(['published', 'candidate', 'history'] as const).map((value) => ({
            key: value,
            label: `${t(`collection.${value}`)} (${items.filter((item) => (value === 'history' ? ['rejected', 'withdrawn'].includes(item.status) : item.status === value)).length})`,
          }))}
        />
      </View>
      <CollectionField
        label={t('collection.search')}
        value={query}
        onChange={(value) => {
          setQuery(value);
          setPage(1);
        }}
      />
      {tab === 'candidate' && selected.size ? (
        <View style={styles.row}>
          <CollectionButton
            label={t('collection.batchPublish')}
            disabled={busy}
            onPress={() => void batch('publish')}
          />
          <CollectionButton
            label={t('collection.batchReject')}
            disabled={busy}
            onPress={() =>
              Alert.alert(t('collection.reject'), t('collection.removeHint'), [
                { text: t('collection.cancel'), style: 'cancel' },
                { text: t('collection.reject'), onPress: () => void batch('reject') },
              ])
            }
          />
        </View>
      ) : null}
      {!loading && !visible.length ? (
        <Text style={styles.hint}>{t('collection.empty')}</Text>
      ) : null}
      {visible
        .slice(
          (Math.min(page, Math.max(1, Math.ceil(visible.length / 20))) - 1) * 20,
          Math.min(page, Math.max(1, Math.ceil(visible.length / 20))) * 20,
        )
        .map((item) => (
          <View style={styles.card} key={item.id}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('collection.openCase')}
              onPress={() => onOpen(item.id)}
            >
              <Text style={styles.heading}>{item.content.title}</Text>
            </Pressable>
            {item.status === 'candidate' ? (
              <CollectionCheck
                label={t('collection.selectCase', { title: item.content.title })}
                checked={selected.has(item.id)}
                onPress={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
              />
            ) : null}
            <Text style={styles.hint}>
              {item.content.category.name} ·{' '}
              {t(
                item.origin === 'automatic'
                  ? 'collection.automaticOrigin'
                  : 'collection.manualOrigin',
              )}
            </Text>
            <Text style={styles.text} numberOfLines={3}>
              {item.content.reason}
            </Text>
            <CollectionButton
              icon="chatbubbles-outline"
              label={t('collection.openCase')}
              onPress={() => onOpen(item.id)}
            />
          </View>
        ))}
      {visible.length > 20 ? (
        <View style={styles.row}>
          <CollectionButton
            label={t('collection.previousPage')}
            disabled={page <= 1}
            onPress={() => setPage((value) => value - 1)}
          />
          <Text style={styles.hint}>
            {Math.min(page, Math.max(1, Math.ceil(visible.length / 20)))}/
            {Math.max(1, Math.ceil(visible.length / 20))}
          </Text>
          <CollectionButton
            label={t('collection.nextPage')}
            disabled={page >= Math.ceil(visible.length / 20)}
            onPress={() => setPage((value) => value + 1)}
          />
        </View>
      ) : null}
    </CollectionLayout>
  );
}
