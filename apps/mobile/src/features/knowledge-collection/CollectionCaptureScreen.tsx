/**
 * 分析标签与对话的手动收集页面。
 *
 * 恢复固定分析版本，允许用户纠正 AI 判断或选择真实对话保存候选。
 *
 * Responsibilities:
 * - 分离原 AI 判断、人工修正和案例编辑。
 * - 保存失败时保留全部输入。
 *
 * Notes:
 * - 建议话术不会冒充原销售音频正文。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import {
  CaseContentSchema,
  type CollectionCapture,
  type AnalysisCorrection,
  type CaseContent,
  type KnowledgeBaseSummary,
  type BusinessAnalysisTagCategory,
} from '@echowave/contracts';
import {
  collectKnowledgeCase,
  getCollectionCapture,
  listAnalysisCorrections,
  listCollectionRules,
  saveAnalysisCorrection,
} from '@/shared/api/collectionApi';
import { listKnowledgeBases } from '@/shared/api/knowledgeBasesApi';
import {
  usePreventRemove,
  type NavigationProp,
  type ParamListBase,
} from 'expo-router/react-navigation';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  CaseContentEditor,
  CollectionButton,
  CollectionField,
  CollectionLayout,
  CollectionPicker,
  styles,
} from './ui';

type Capture = CollectionCapture;
/** 为选中标签保留证据跨度及其紧邻顾客轮次。 */
function initialContent(capture: Capture, tagId: string | undefined, name: string): CaseContent {
  const tag = capture.tags.find((v) => v.id === tagId);
  const indexes = capture.availableTurns
    .map((turn, i) => (tag?.segmentIds.includes(turn.segmentId) ? i : -1))
    .filter((i) => i >= 0);
  let first = indexes.length ? Math.min(...indexes) : 0;
  while (first > 0 && capture.availableTurns[first - 1]!.role === 'customer') first--;
  const last = indexes.length ? Math.max(...indexes) : capture.availableTurns.length - 1;
  const id =
    tag?.category === 'strength'
      ? 'strength'
      : tag?.category === 'improvement'
        ? 'improvement'
        : (tag?.category ?? 'dialogue');
  return {
    title: tag?.title ?? name,
    reason: tag?.reason ?? name,
    category: { id, name },
    supplement: '',
    suggestedReply: '',
    turns: capture.availableTurns.slice(first, last + 1),
  };
}
/** 收集固定标签或用户勾选的对话，纠正记录另外保存。 */
export function CollectionCaptureScreen({
  jobId,
  tagId: initialTagId,
  correct = false,
  onBack,
  onSaved,
  navigation,
}: {
  navigation?: Pick<NavigationProp<ParamListBase>, 'dispatch'>;
  jobId: string;
  tagId?: string;
  correct?: boolean;
  onBack: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useAppLanguage();
  const [capture, setCapture] = useState<Capture>();
  const [bases, setBases] = useState<KnowledgeBaseSummary[]>([]);
  const [categories, setCategories] = useState<CaseContent['category'][]>([]);
  const initialized = useRef<string | undefined>(undefined);
  const completed = useRef(false);
  const [tagId, setTagId] = useState(initialTagId);
  const [content, setContent] = useState<CaseContent>();
  const [target, setTarget] = useState('');
  const [corrections, setCorrections] = useState<AnalysisCorrection[]>([]);
  const [correction, setCorrection] = useState<AnalysisCorrection>();
  const [editingCorrection, setEditingCorrection] = useState(correct);
  const [reason, setReason] = useState('');
  const [reply, setReply] = useState('');
  const [category, setCategory] = useState<BusinessAnalysisTagCategory>('strength');
  const [customLabel, setCustomLabel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([getCollectionCapture(jobId), listKnowledgeBases()]);
      const r = await listCollectionRules(c.groupId);
      setCategories([
        ...new Map(r.items.map((rule) => [rule.category.id, rule.category])).values(),
      ]);
      setCapture(c);
      setBases(b.items);
      setError('');
    } catch {
      setError(t('collection.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [jobId, t]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  useEffect(() => {
    if (!capture) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const tag = capture.tags.find((v) => v.id === tagId);
      const key = `${jobId}:${tagId ?? 'dialogue'}`;
      const initialize = initialized.current !== key;
      initialized.current = key;
      if (initialize) {
        setContent(
          initialContent(
            capture,
            tagId,
            tag ? t(`collection.${tag.category}`) : t('collection.dialogue'),
          ),
        );
        setReason(tag?.reason ?? '');
        setCategory(tag?.category ?? 'strength');
        setCustomLabel(tag?.customLabel ?? '');
        setReply('');
        setCorrection(undefined);
        setCorrections([]);
      }
      if (tagId) {
        setBusy(true);
        void listAnalysisCorrections(jobId, tagId)
          .then((result) => {
            if (!active) return;
            setCorrections(result.items);
            const newest = result.items[0];
            if (newest && initialize) {
              setCorrection(newest);
              setReason(newest.reason);
              setReply(newest.suggestedReply);
              setCategory(newest.category);
              setCustomLabel(newest.customLabel ?? '');
              setContent((current) =>
                current
                  ? {
                      ...current,
                      reason: newest.reason,
                      suggestedReply: newest.suggestedReply,
                      category: { id: 'correction', name: t('collection.correction') },
                    }
                  : current,
              );
            }
          })
          .catch(() => {
            if (active) setError(t('collection.loadFailed'));
          })
          .finally(() => {
            if (active) setBusy(false);
          });
      }
    });
    return () => {
      active = false;
    };
  }, [capture, jobId, tagId, t]);
  const saveCorrection = async () => {
    if (!tagId) return;
    setBusy(true);
    setError('');
    try {
      const saved = await saveAnalysisCorrection(jobId, tagId, {
        expectedVersion: correction?.version ?? 0,
        category,
        customLabel: category === 'custom' ? customLabel : null,
        reason,
        suggestedReply: reply,
      });
      setCorrection(saved);
      setCorrections([saved, ...corrections]);
      setEditingCorrection(false);
      setContent((current) =>
        current
          ? {
              ...current,
              reason: saved.reason,
              suggestedReply: saved.suggestedReply,
              category: { id: 'correction', name: t('collection.correction') },
            }
          : current,
      );
    } catch {
      setError(t('collection.saveFailed'));
    } finally {
      setBusy(false);
    }
  };
  const collect = async () => {
    if (!content || !capture) return;
    setBusy(true);
    setError('');
    try {
      const parsed = CaseContentSchema.safeParse(content);
      if (!parsed.success || !target) {
        setError(t('collection.invalid'));
        return;
      }
      const saved = await collectKnowledgeCase({
        jobId,
        knowledgeBaseId: target,
        category: content.category,
        content: parsed.data,
        ...(correction
          ? { correctionId: correction.id }
          : tagId
            ? { tagId }
            : { segmentIds: content.turns.map((v) => v.segmentId) }),
      });
      completed.current = true;
      onSaved(saved.id);
    } catch {
      setError(t('collection.saveFailed'));
    } finally {
      setBusy(false);
    }
  };
  const tag = capture?.tags.find((v) => v.id === tagId);
  const leave = (next: () => void) => {
    if (busy) return;
    Alert.alert(t('collection.unsaved'), t('collection.unsavedHint'), [
      { text: t('collection.cancel'), style: 'cancel' },
      { text: t('collection.discard'), style: 'destructive', onPress: next },
    ]);
  };
  usePreventRemove(!!navigation && !!content, ({ data }) => {
    if (completed.current) {
      navigation?.dispatch(data.action);
      return;
    }
    leave(() => navigation?.dispatch(data.action));
  });
  return (
    <CollectionLayout
      title={t(editingCorrection ? 'collection.correct' : 'collection.collect')}
      loading={loading}
      error={error}
      onRetry={() => void load()}
      onRefresh={load}
      footer={
        capture ? (
          <>
            <View style={styles.footerAction}>
              <CollectionButton
                label={t('collection.cancel')}
                disabled={busy}
                onPress={() => leave(onBack)}
              />
            </View>
            <View style={styles.footerAction}>
              <CollectionButton
                label={t(
                  editingCorrection ? 'collection.saveCorrection' : 'collection.saveCandidate',
                )}
                disabled={busy}
                onPress={() => void (editingCorrection ? saveCorrection() : collect())}
              />
            </View>
          </>
        ) : undefined
      }
      onBack={() => leave(onBack)}
    >
      {capture ? (
        <>
          <Text style={styles.heading}>{t('collection.selectSource')}</Text>
          <CollectionButton
            label={t('collection.dialogue')}
            selected={!tagId}
            disabled={busy}
            onPress={() => {
              setTagId(undefined);
              setEditingCorrection(false);
            }}
          />
          {capture.tags.map((v) => (
            <CollectionButton
              key={v.id}
              label={v.title}
              selected={tagId === v.id}
              disabled={busy}
              onPress={() => setTagId(v.id)}
            />
          ))}
          {tag ? (
            <View style={styles.card}>
              <Text style={styles.heading}>{t('collection.originalJudgment')}</Text>
              <Text style={styles.text}>{tag.reason}</Text>
              <CollectionButton
                label={t(editingCorrection ? 'collection.collect' : 'collection.correct')}
                disabled={busy}
                onPress={() => setEditingCorrection(!editingCorrection)}
              />
            </View>
          ) : null}
          {editingCorrection && tag ? (
            <View style={styles.card}>
              <CollectionField
                label={t('collection.reason')}
                value={reason}
                multiline
                onChange={setReason}
              />
              <CollectionField
                label={t('collection.suggestedReply')}
                value={reply}
                multiline
                onChange={setReply}
              />
              <View style={styles.row}>
                {(['strength', 'improvement', 'risk', 'suggestion', 'custom'] as const).map((v) => (
                  <CollectionButton
                    key={v}
                    label={t(`collection.${v}`)}
                    selected={category === v}
                    onPress={() => setCategory(v)}
                  />
                ))}
              </View>
              {category === 'custom' ? (
                <CollectionField
                  label={t('collection.categoryName')}
                  value={customLabel}
                  onChange={setCustomLabel}
                />
              ) : null}
              {corrections.map((v) => (
                <View key={v.id}>
                  <Text style={styles.hint}>{t('collection.version', { version: v.version })}</Text>
                  <Text style={styles.text}>{v.reason}</Text>
                </View>
              ))}
            </View>
          ) : content ? (
            <>
              <CollectionPicker
                label={t('collection.target')}
                options={bases}
                single
                selectedIds={[target]}
                summary={
                  bases.find((base) => base.id === target)?.name ?? t('collection.selectTarget')
                }
                onSelect={setTarget}
              />
              {!bases.length ? (
                <Text style={styles.hint}>{t('collection.createLibrary')}</Text>
              ) : null}
              <View style={styles.row}>
                {categories.map((category) => (
                  <CollectionButton
                    key={category.id}
                    label={category.name}
                    selected={content.category.id === category.id}
                    onPress={() => setContent({ ...content, category })}
                  />
                ))}
                <CollectionButton
                  label={t('collection.custom')}
                  onPress={() =>
                    setContent({ ...content, category: { id: `custom-${Date.now()}`, name: '' } })
                  }
                />
              </View>
              <CaseContentEditor
                content={content}
                availableTurns={capture.availableTurns}
                onChange={setContent}
              />
            </>
          ) : null}
        </>
      ) : null}
    </CollectionLayout>
  );
}
