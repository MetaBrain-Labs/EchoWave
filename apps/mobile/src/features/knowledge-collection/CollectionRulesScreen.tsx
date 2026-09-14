/**
 * 分组知识收集设置页面。
 *
 * 编辑三种收集模式、可扩展类别和筛选条件，并启动可预览的历史补收。
 *
 * Responsibilities:
 * - 展示规则版本与权威补收进度。
 * - 请求失败时保留用户编辑。
 *
 * Notes:
 * - 规则不生成新的 AI 分析任务。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  usePreventRemove,
  type NavigationProp,
  type ParamListBase,
} from 'expo-router/react-navigation';
import { Alert, BackHandler, Text, View } from 'react-native';
import {
  CollectionRuleInputSchema,
  type CollectionRule,
  type CollectionRuleInput,
  type CollectionRun,
  type DataSourceSummary,
  type KnowledgeBaseSummary,
} from '@echowave/contracts';
import { listKnowledgeBases } from '@/shared/api/knowledgeBasesApi';
import { getGroup, listGroupDataSources } from '@/shared/api/groupsApi';
import {
  listCollectionRules,
  listCollectionRuns,
  previewCollectionHistory,
  retryCollectionRun,
  saveCollectionRule,
  startCollectionHistory,
} from '@/shared/api/collectionApi';
import { FixedActionButton } from '@/shared/ui/FixedActionButton';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';
import {
  CollectionButton,
  CollectionCheck,
  CollectionField,
  CollectionLayout,
  CollectionPicker,
  CollectionNavigationRow,
  styles,
} from './ui';

/** 收集来源类别保持固定，目标类别可以任意扩展。 */
const sourceOptions = [
  'strength',
  'improvement',
  'correction',
  'risk',
  'suggestion',
  'custom',
] as const;
/** 将用户输入的多值条件规范化，空条件不限制来源。 */
function values(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，\n]/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

/** 编辑分组规则并管理历史补收。 */
export function CollectionRulesScreen({
  groupId,
  onBack,
  onSwitchGroup,
  defaultKnowledgeId,
  guideDemo = false,
  navigation,
  view = 'home',
  ruleId,
  onOperation,
}: {
  groupId: string;
  view?: 'home' | 'rule' | 'history';
  ruleId?: string;
  onOperation?: (view: 'rule' | 'history', ruleId?: string) => void;
  onBack: () => void;
  onSwitchGroup?: () => void;
  defaultKnowledgeId?: string;
  guideDemo?: boolean;
  navigation?: Pick<NavigationProp<ParamListBase>, 'dispatch'>;
}) {
  const { t } = useAppLanguage();
  const rulesTargetRef = useStarterTourTarget('collection-rules');
  const editorTargetRef = useStarterTourTarget('collection-rule-editor');
  const historyTargetRef = useStarterTourTarget('collection-history');
  const defaults = useCallback(
    (): CollectionRuleInput => ({
      name: '',
      enabled: true,
      mode: 'review',
      category: { id: 'strength', name: t('collection.strength') },
      knowledgeBaseId: defaultKnowledgeId ?? '',
      filters: {
        sources: ['strength'],
        customLabels: [],
        dataSourceIds: [],
        minimumConfidence: null,
        keywords: [],
      },
    }),
    [t, defaultKnowledgeId],
  );
  const [groupName, setGroupName] = useState('');
  const initialized = useRef(false);
  const committed = useRef(false);
  const [historyRuleId, setHistoryRuleId] = useState(ruleId ?? '');
  const [rules, setRules] = useState<CollectionRule[]>([]);
  const [bases, setBases] = useState<KnowledgeBaseSummary[]>([]);
  const [sources, setSources] = useState<DataSourceSummary[]>([]);
  const [runs, setRuns] = useState<CollectionRun[]>([]);
  const [draft, setDraft] = useState(defaults);
  const [editing, setEditing] = useState(view === 'rule');
  const [baseline, setBaseline] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [previous, setPrevious] = useState<CollectionRule>();
  const [labels, setLabels] = useState('');
  const [keywords, setKeywords] = useState('');
  const [confidence, setConfidence] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState<number>();
  const load = useCallback(async () => {
    try {
      const [r, b, s, u, group] = await Promise.all([
        listCollectionRules(groupId),
        listKnowledgeBases(),
        listGroupDataSources(groupId),
        listCollectionRuns(groupId),
        getGroup(groupId),
      ]);
      setGroupName(group.name);
      setRules(r.items);
      setBases(b.items);
      setSources(s.items);
      setRuns(u.items);
      setError('');
    } catch {
      setError(t('collection.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [groupId, t]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  useEffect(() => {
    if (!runs.some((r) => r.status === 'queued' || r.status === 'running')) return;
    const timer = setInterval(() => {
      void listCollectionRuns(groupId)
        .then((r) => setRuns(r.items))
        .catch(() => setError(t('collection.loadFailed')));
    }, 3000);
    return () => clearInterval(timer);
  }, [groupId, runs, t]);
  /** 新增规则应用入口默认库，已有规则保留服务器目标与版本。 */
  const edit = useCallback(
    (rule?: CollectionRule) => {
      setEditing(true);
      setEditorKey((v) => v + 1);
      const value = rule
        ? {
            name: rule.name,
            enabled: rule.enabled,
            mode: rule.mode,
            category: rule.category,
            knowledgeBaseId: rule.knowledgeBaseId,
            filters: rule.filters,
          }
        : defaults();
      setBaseline(
        JSON.stringify({
          draft: value,
          labels: rule?.filters.customLabels.join(', ') ?? '',
          keywords: rule?.filters.keywords.join(', ') ?? '',
          confidence: rule?.filters.minimumConfidence?.toString() ?? '',
        }),
      );
      setPrevious(rule);
      setDraft(value);
      setLabels(rule?.filters.customLabels.join(', ') ?? '');
      setKeywords(rule?.filters.keywords.join(', ') ?? '');
      setConfidence(rule?.filters.minimumConfidence?.toString() ?? '');
      setPreview(undefined);
    },
    [defaults],
  );
  useEffect(() => {
    if (view !== 'rule' || loading || initialized.current) return;
    initialized.current = true;
    void Promise.resolve().then(() => {
      const rule = ruleId ? rules.find((r) => r.id === ruleId) : undefined;
      if (ruleId && !rule && !guideDemo) {
        setError(t('collection.loadFailed'));
        return;
      }
      edit(rule);
    });
  }, [view, loading, ruleId, rules, t, edit, guideDemo]);
  const save = async () => {
    if (guideDemo) return;
    setBusy(true);
    setError('');
    try {
      const parsed = CollectionRuleInputSchema.safeParse({
        ...draft,
        filters: {
          ...draft.filters,
          customLabels: values(labels),
          keywords: values(keywords),
          minimumConfidence: confidence.trim() ? Number(confidence) : null,
        },
      });
      if (!parsed.success) {
        setError(t('collection.invalid'));
        return;
      }
      const rule = await saveCollectionRule(groupId, parsed.data, previous);
      edit(rule);
      setEditing(false);
      await load();
      if (onOperation) {
        committed.current = true;
        onBack();
      }
    } catch {
      setError(t('collection.saveFailed'));
    } finally {
      setBusy(false);
    }
  };
  const history = async (start: boolean) => {
    const historyRule = rules.find((r) => r.id === (historyRuleId || previous?.id));
    if (!historyRule) {
      setError(t('collection.invalid'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
        throw new Error('Invalid date.');
      const range = {
        ruleId: historyRule.id,
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59.999`).toISOString(),
      };
      if (start) {
        await startCollectionHistory(groupId, range);
        setPreview(undefined);
        await load();
      } else setPreview((await previewCollectionHistory(groupId, range)).count);
    } catch {
      setError(t('collection.historyFailed'));
    } finally {
      setBusy(false);
    }
  };
  const dirty = editing && baseline !== JSON.stringify({ draft, labels, keywords, confidence });
  // 使用 Expo Router 内置移除保护，覆盖原生手势、系统返回及浏览器导航。
  usePreventRemove(!!navigation && !guideDemo && editing && (dirty || busy), ({ data }) => {
    if (committed.current) {
      navigation?.dispatch(data.action);
      return;
    }
    if (busy) return;
    Alert.alert(t('collection.unsaved'), t('collection.unsavedHint'), [
      { text: t('collection.cancel'), style: 'cancel' },
      {
        text: t('collection.discard'),
        style: 'destructive',
        onPress: () => navigation?.dispatch(data.action),
      },
    ]);
  });
  /** 离开编辑或切换分组前必须明确放弃未保存输入。 */
  const leave = (next: () => void) => {
    if (busy) return;
    if (guideDemo) {
      next();
      return;
    }
    if (!dirty) {
      next();
      return;
    }
    Alert.alert(t('collection.unsaved'), t('collection.unsavedHint'), [
      { text: t('collection.cancel'), style: 'cancel' },
      { text: t('collection.discard'), style: 'destructive', onPress: next },
    ]);
  };
  const back = () => {
    if (busy) return;
    // 独立编辑页由导航统一确认，内嵌表单仍确认后退出编辑状态。
    if (navigation && (!editing || onOperation)) onBack();
    else leave(editing && !onOperation ? () => setEditing(false) : onBack);
  };
  useEffect(() => {
    if (guideDemo) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!editing) return false;
      if (busy) return true;
      if (navigation && onOperation) {
        onBack();
        return true;
      }
      if (!busy) {
        if (dirty)
          Alert.alert(t('collection.unsaved'), t('collection.unsavedHint'), [
            { text: t('collection.cancel'), style: 'cancel' },
            {
              text: t('collection.discard'),
              style: 'destructive',
              onPress: () => (onOperation ? onBack() : setEditing(false)),
            },
          ]);
        else if (onOperation) onBack();
        else setEditing(false);
      }
      return true;
    });
    return () => subscription.remove();
  }, [editing, busy, dirty, t, onOperation, onBack, navigation, guideDemo]);
  const targetUnavailable =
    !!draft.knowledgeBaseId && !bases.some((base) => base.id === draft.knowledgeBaseId);
  return (
    <CollectionLayout
      title={t(
        view === 'history'
          ? 'collection.history'
          : view === 'rule'
            ? 'collection.ruleName'
            : 'collection.rules',
      )}
      onBack={back}
      loading={loading}
      error={error}
      onRetry={() => void load()}
      onRefresh={load}
      footer={
        editing ? (
          <>
            <View style={styles.footerAction}>
              <FixedActionButton
                icon="close-outline"
                label={t('collection.cancel')}
                disabled={busy}
                onPress={back}
              />
            </View>
            <View style={styles.footerAction}>
              <FixedActionButton
                emphasized
                icon="checkmark-outline"
                label={t('collection.saveRule')}
                disabled={
                  guideDemo || busy || loading || targetUnavailable || (!!ruleId && !previous)
                }
                onPress={() => void save()}
              />
            </View>
          </>
        ) : undefined
      }
    >
      <View collapsable={false} ref={rulesTargetRef}>
        <Text style={styles.hint}>{t('collection.rulesHint')}</Text>
      </View>
      {view === 'home' && !editing ? (
        <>
          {onSwitchGroup ? (
            <CollectionNavigationRow
              uniformHeight
              icon="swap-horizontal-outline"
              title={t('collection.switchGroup')}
              description={groupName || t('collection.loading')}
              onPress={onSwitchGroup}
            />
          ) : null}
          <CollectionNavigationRow
            uniformHeight
            icon="add-outline"
            title={t('collection.newRule')}
            description={t('collection.newRuleHint')}
            onPress={() => (onOperation ? onOperation('rule') : edit())}
          />
          <CollectionNavigationRow
            uniformHeight
            icon="time-outline"
            title={t('collection.history')}
            description={t('collection.historyHint')}
            onPress={() => onOperation?.('history')}
          />
          <Text style={styles.heading}>{t('collection.existingRules')}</Text>
          {!rules.length && !loading ? (
            <Text style={styles.hint}>{t('collection.noRules')}</Text>
          ) : null}
          {rules.map((rule) => (
            <CollectionNavigationRow
              key={rule.id}
              title={rule.name}
              description={`${t(`collection.${rule.mode}`)} · ${t(rule.enabled ? 'collection.enabled' : 'collection.disabled')} · ${bases.find((base) => base.id === rule.knowledgeBaseId)?.name ?? t('collection.targetUnavailable')}`}
              onPress={() => (onOperation ? onOperation('rule', rule.id) : edit(rule))}
            />
          ))}
        </>
      ) : null}
      {editing && onSwitchGroup ? (
        <CollectionNavigationRow
          title={t('collection.switchGroup')}
          description={groupName}
          icon="swap-horizontal-outline"
          onPress={() =>
            leave(() => {
              setEditing(false);
              onSwitchGroup();
            })
          }
        />
      ) : null}
      {editing ? (
        <View collapsable={false} key={editorKey} ref={editorTargetRef} style={styles.card}>
          {previous && onOperation ? (
            <CollectionNavigationRow
              title={t('collection.history')}
              icon="time-outline"
              onPress={() => leave(() => onOperation('history', previous.id))}
            />
          ) : null}
          <CollectionField
            label={t('collection.ruleName')}
            value={draft.name}
            onChange={(name) => setDraft({ ...draft, name })}
          />
          <CollectionCheck
            label={t('collection.enabled')}
            checked={draft.enabled}
            onPress={() => setDraft({ ...draft, enabled: !draft.enabled })}
          />
          <Text style={styles.heading}>{t('collection.mode')}</Text>
          <View style={styles.row}>
            {(['review', 'direct', 'manual'] as const).map((mode) => (
              <CollectionButton
                key={mode}
                label={t(`collection.${mode}`)}
                selected={draft.mode === mode}
                onPress={() => setDraft({ ...draft, mode })}
              />
            ))}
          </View>
          <Text style={styles.heading}>{t('collection.categoryName')}</Text>
          <View style={styles.row}>
            {(['strength', 'improvement', 'correction'] as const).map((id) => (
              <CollectionButton
                key={id}
                label={t(`collection.${id}`)}
                selected={draft.category.id === id}
                onPress={() =>
                  setDraft({ ...draft, category: { id, name: t(`collection.${id}`) } })
                }
              />
            ))}
            <CollectionButton
              label={t('collection.custom')}
              selected={!['strength', 'improvement', 'correction'].includes(draft.category.id)}
              onPress={() =>
                setDraft({ ...draft, category: { id: `custom-${Date.now()}`, name: '' } })
              }
            />
          </View>
          <CollectionField
            label={t('collection.categoryName')}
            value={draft.category.name}
            onChange={(name) => setDraft({ ...draft, category: { ...draft.category, name } })}
          />
          <View style={styles.row}>
            {[...new Map(rules.map((rule) => [rule.category.id, rule.category])).values()]
              .filter(
                (category) => !['strength', 'improvement', 'correction'].includes(category.id),
              )
              .map((category) => (
                <CollectionButton
                  key={category.id}
                  label={category.name}
                  selected={draft.category.id === category.id}
                  onPress={() => setDraft({ ...draft, category })}
                />
              ))}
          </View>
          <CollectionPicker
            label={t('collection.target')}
            single
            options={bases}
            summary={
              bases.find((base) => base.id === draft.knowledgeBaseId)?.name ??
              t(targetUnavailable ? 'collection.targetUnavailable' : 'collection.selectTarget')
            }
            selectedIds={[draft.knowledgeBaseId]}
            onSelect={(id) => setDraft({ ...draft, knowledgeBaseId: id })}
          />
          {targetUnavailable && !loading ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {t('collection.targetUnavailable')}
            </Text>
          ) : null}
          {!bases.length ? <Text style={styles.hint}>{t('collection.createLibrary')}</Text> : null}
          <Text style={styles.heading}>{t('collection.filterSources')}</Text>
          {sourceOptions.map((source) => (
            <CollectionCheck
              key={source}
              label={t(`collection.${source}`)}
              checked={draft.filters.sources.includes(source)}
              onPress={() =>
                setDraft({
                  ...draft,
                  filters: {
                    ...draft.filters,
                    sources: draft.filters.sources.includes(source)
                      ? draft.filters.sources.filter((s) => s !== source)
                      : [...draft.filters.sources, source],
                  },
                })
              }
            />
          ))}
          <CollectionField
            label={t('collection.customLabels')}
            value={labels}
            onChange={setLabels}
          />
          <CollectionField
            label={t('collection.keywords')}
            value={keywords}
            onChange={setKeywords}
          />
          <CollectionField
            label={t('collection.minimumConfidence')}
            value={confidence}
            onChange={setConfidence}
          />
          <CollectionPicker
            label={t('collection.dataSources')}
            options={sources}
            summary={
              draft.filters.dataSourceIds.length
                ? t('collection.selectedSources', { count: draft.filters.dataSourceIds.length })
                : t('collection.unrestricted')
            }
            selectedIds={draft.filters.dataSourceIds}
            onSelect={(id) =>
              setDraft({
                ...draft,
                filters: {
                  ...draft.filters,
                  dataSourceIds: draft.filters.dataSourceIds.includes(id)
                    ? draft.filters.dataSourceIds.filter((value) => value !== id)
                    : [...draft.filters.dataSourceIds, id],
                },
              })
            }
          />
        </View>
      ) : null}
      {view === 'history' ? (
        <View collapsable={false} ref={historyTargetRef} style={styles.card}>
          <Text style={styles.heading}>{t('collection.history')}</Text>
          <CollectionPicker
            label={t('collection.selectRule')}
            single
            options={rules.map((rule) => ({ id: rule.id, name: rule.name }))}
            selectedIds={[historyRuleId]}
            summary={
              rules.find((rule) => rule.id === historyRuleId)?.name ?? t('collection.selectRule')
            }
            onSelect={(id) => {
              setHistoryRuleId(id);
              setPreview(undefined);
            }}
          />
          <Text style={styles.hint}>{t('collection.historyHint')}</Text>
          <CollectionField
            label={t('collection.from')}
            value={from}
            onChange={(v) => {
              setFrom(v);
              setPreview(undefined);
            }}
          />
          <CollectionField
            label={t('collection.to')}
            value={to}
            onChange={(v) => {
              setTo(v);
              setPreview(undefined);
            }}
          />
          <CollectionButton
            label={t('collection.preview')}
            disabled={busy}
            onPress={() => void history(false)}
          />
          {preview !== undefined ? (
            <>
              <Text style={styles.text}>{t('collection.matchCount', { count: preview })}</Text>
              <CollectionButton
                label={t('collection.startHistory')}
                disabled={busy}
                onPress={() => void history(true)}
              />
            </>
          ) : null}
        </View>
      ) : null}
      {view === 'history'
        ? runs.map((run) => (
            <View key={run.id} style={styles.card}>
              <Text style={styles.text}>
                {t(`collection.${run.status}`)} · {run.completed}/{run.total}
              </Text>
              {run.error ? <Text style={styles.error}>{run.error}</Text> : null}
              {run.failed > 0 ? (
                <CollectionButton
                  label={t('collection.retry')}
                  disabled={busy}
                  onPress={() => {
                    setBusy(true);
                    void retryCollectionRun(groupId, run.id)
                      .then(load)
                      .catch(() => setError(t('collection.historyFailed')))
                      .finally(() => setBusy(false));
                  }}
                />
              ) : null}
            </View>
          ))
        : null}
    </CollectionLayout>
  );
}
