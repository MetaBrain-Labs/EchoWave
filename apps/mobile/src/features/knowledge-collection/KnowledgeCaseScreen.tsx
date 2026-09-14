/**
 * 学习案例详情与回听页面。
 *
 * 展示原对话、评价和人工建议，并审核或版本化编辑案例。
 *
 * Responsibilities:
 * - 通过共享播放器按顾客、销售或时间顺序连续回听。
 * - 将文本发布与媒体失败分开反馈。
 *
 * Notes:
 * - 不实现模拟录音或模型评分。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Text, View } from 'react-native';
import { CaseContentSchema, type CaseContent, type KnowledgeCase } from '@echowave/contracts';
import {
  actOnKnowledgeCase,
  getKnowledgeCase,
  updateKnowledgeCase,
} from '@/shared/api/collectionApi';
import { ActionSheet } from '@/shared/ui/ActionSheet';
import { usePreventRemove, type NavigationProp, type ParamListBase } from 'expo-router/react-navigation';
import { useCasePlayback, caseTime } from './useCasePlayback';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  CaseContentEditor,
  CollectionAudioControl,
  CollectionButton,
  CollectionLayout,
  styles,
} from './ui';

/** 一个有原声来源、明确角色和独立发布状态的案例。 */
export function KnowledgeCaseScreen({
  caseId,
  onBack,
  initiallyEditing = false,
  navigation,
}: {
  caseId: string;
  onBack: () => void;
  initiallyEditing?: boolean;
  navigation?: Pick<NavigationProp<ParamListBase>, 'dispatch'>;
}) {
  const { t } = useAppLanguage();
  const [item, setItem] = useState<KnowledgeCase>();
  const [draft, setDraft] = useState<CaseContent>();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const initialized = useRef(false);
  const editVersion = useRef<number | undefined>(undefined);
  const audio = useCasePlayback(item);
  const playback = audio.playback;
  const load = useCallback(async () => {
    try {
      const current = await getKnowledgeCase(caseId);
      setItem(current);
      if (
        initiallyEditing &&
        !initialized.current &&
        ['candidate', 'published'].includes(current.status)
      ) {
        initialized.current = true;
        setDraft(current.content);
        editVersion.current = current.version;
        setEditing(true);
      }
      setError('');
    } catch {
      setError(t('collection.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [caseId, t, initiallyEditing]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  useEffect(() => {
    if (
      !item ||
      editing ||
      item.status !== 'published' ||
      (item.publication !== 'pending' && !item.media.some((m) => m.status === 'pending'))
    )
      return;
    const timer = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [editing, item, load]);
  const action = async (value: 'publish' | 'reject' | 'withdraw' | 'delete' | 'retry') => {
    if (!item) return;
    setBusy(true);
    setError('');
    try {
      const updated = await actOnKnowledgeCase(item.id, item.version, value);
      setItem(updated);
      setMenu(false);
      if (value === 'delete') onBack();
    } catch {
      setError(t('collection.saveFailed'));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!item || !draft) return;
    setBusy(true);
    setError('');
    try {
      const parsed = CaseContentSchema.safeParse(draft);
      if (!parsed.success) {
        setError(t('collection.invalid'));
        return;
      }
      setItem(await updateKnowledgeCase(item.id, editVersion.current ?? item.version, parsed.data));
      setEditing(false);
    } catch {
      setError(t('collection.saveFailed'));
    } finally {
      setBusy(false);
    }
  };
  const confirmAction = (value: 'reject' | 'withdraw' | 'delete') =>
    Alert.alert(t(`collection.${value}`), t('collection.removeHint'), [
      { text: t('collection.cancel'), style: 'cancel' },
      { text: t(`collection.${value}`), style: 'destructive', onPress: () => void action(value) },
    ]);
  const back = () => {
    if (busy) return;
    if (editing)
      Alert.alert(t('collection.unsaved'), t('collection.unsavedHint'), [
        { text: t('collection.cancel'), style: 'cancel' },
        { text: t('collection.discard'), style: 'destructive', onPress: onBack },
      ]);
    else onBack();
  };
  useEffect(() => {
    if (!editing) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) return true;
      Alert.alert(t('collection.unsaved'), t('collection.unsavedHint'), [
        { text: t('collection.cancel'), style: 'cancel' },
        { text: t('collection.discard'), style: 'destructive', onPress: onBack },
      ]);
      return true;
    });
    return () => subscription.remove();
  }, [editing, onBack, t, busy]);
  usePreventRemove(!!navigation && editing, ({ data }) => {
    if (busy) return;
    Alert.alert(t('collection.unsaved'), t('collection.unsavedHint'), [
      { text: t('collection.cancel'), style: 'cancel' },
      { text: t('collection.discard'), onPress: () => navigation?.dispatch(data.action) },
    ]);
  });
  /** 编辑使用打开时的版本；静默刷新不能悄悄接受并发修改。 */
  const edit = () => {
    if (!item) return;
    setDraft(item.content);
    editVersion.current = item.version;
    setEditing(true);
    setMenu(false);
  };
  const cancel = () => {
    if (!draft || JSON.stringify(draft) === JSON.stringify(item?.content)) {
      setEditing(false);
      return;
    }
    Alert.alert(t('collection.unsaved'), t('collection.unsavedHint'), [
      { text: t('collection.cancel'), style: 'cancel' },
      { text: t('collection.discard'), onPress: () => setEditing(false) },
    ]);
  };
  const retryable =
    item?.status === 'published' &&
    (!!playback.error || (item.publication === 'failed' && item.publicationRetryable !== false) ||
      item.media.some((media) => ['failed', 'missing'].includes(media.status)));
  const actions = [
    ...(['candidate', 'published'].includes(item?.status ?? '')
      ? [{ label: t('collection.edit'), icon: 'create-outline' as const, onPress: edit }]
      : []),
    ...(item?.status === 'published'
      ? [{ label: t('collection.withdraw'), onPress: () => confirmAction('withdraw') }]
      : []),
    ...(retryable ? [{ label: t('collection.retry'), onPress: () => void action('retry') }] : []),
    { label: t('collection.delete'), onPress: () => confirmAction('delete') },
    ...(error ? [{ label: t('collection.readServerState'), onPress: () => void load() }] : []),
  ];
  return (
    <CollectionLayout
      title={t('collection.openCase')}
      onBack={back}
      loading={loading}
      error={error}
      onRetry={() => void load()}
      onRefresh={load}
      onMore={item && !editing ? () => setMenu(true) : undefined}
      footer={
        item ? (
          editing ? (
            <>
              <View style={styles.footerAction}>
                <CollectionButton label={t('collection.cancel')} disabled={busy} onPress={cancel} />
              </View>
              <View style={styles.footerAction}>
                <CollectionButton label={t('collection.saveCase')} disabled={busy} onPress={() => void save()} />
              </View>
            </>
          ) : item.status === 'candidate' ? (
            <>
              <View style={styles.footerAction}>
                <CollectionButton label={t('collection.reject')} disabled={busy} onPress={() => confirmAction('reject')} />
              </View>
              <View style={styles.footerAction}>
                <CollectionButton label={t('collection.publish')} disabled={busy} onPress={() => void action('publish')} />
              </View>
            </>
          ) : item.status === 'published' ? (
            <View style={styles.footerAction}>
              <CollectionButton label={t('collection.edit')} disabled={busy} onPress={edit} />
            </View>
          ) : undefined
        ) : undefined
      }
    >
      <ActionSheet
        visible={menu}
        title={item?.content.title ?? t('collection.openCase')}
        closeLabel={t('collection.cancel')}
        onClose={() => setMenu(false)}
        busy={busy}
        message={error || item?.publicationMessage || undefined}
        actions={actions}
      />
      {item ? (
        <>
          <Text style={styles.displayTitle}>{item.content.title}</Text>
          <Text style={styles.hint}>
            {item.content.category.name} · {t(`collection.${item.status}`)} ·{' '}
            {t('collection.version', { version: item.version })}
          </Text>
          {item.sourceUpdated ? (
            <Text accessibilityRole="alert" style={styles.hint}>
              {t('collection.sourceUpdated')}
            </Text>
          ) : null}
          <Text style={styles.hint}>
            {t('collection.sourceVersion', { version: item.source.confirmationVersion })}
          </Text>
          <Text style={styles.hint}>
            {t(
              item.origin === 'automatic'
                ? 'collection.automaticOrigin'
                : 'collection.manualOrigin',
            )}{' '}
            · {t(`collection.${item.source.collectionMode}`)}
          </Text>
          {item.source.originalJudgment ? (
            <View style={styles.card}>
              <Text style={styles.heading}>
                {t('collection.originalJudgment')} ·{' '}
                {t(`collection.${item.source.originalJudgment.category}`)}
              </Text>
              <Text style={styles.text}>{item.source.originalJudgment.reason}</Text>
            </View>
          ) : null}
          {item.source.correctionSnapshot ? (
            <View style={styles.card}>
              <Text style={styles.heading}>
                {t('collection.correction')} ·{' '}
                {t('collection.version', { version: item.source.correctionSnapshot.version })}
              </Text>
              <Text style={styles.text}>{item.source.correctionSnapshot.reason}</Text>
              <Text style={styles.text}>{item.source.correctionSnapshot.suggestedReply}</Text>
            </View>
          ) : null}
          {item.status === 'published' ? (
            <>
              <Text style={styles.hint}>
                {t('collection.publication')}：{t(`collection.${item.publication}`)}
              </Text>
              {item.publicationMessage ? (
                <Text style={styles.error}>{item.publicationMessage}</Text>
              ) : null}
            </>
          ) : null}
          {editing && draft ? (
            <>
              <CaseContentEditor
                content={draft}
                availableTurns={item.availableTurns}
                onChange={setDraft}
              />
            </>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.heading}>{t('collection.reason')}</Text>
                <Text style={styles.text}>{item.content.reason}</Text>
                {item.content.supplement ? (
                  <>
                    <Text style={styles.heading}>{t('collection.supplement')}</Text>
                    <Text style={styles.text}>{item.content.supplement}</Text>
                  </>
                ) : null}
                {item.content.suggestedReply ? (
                  <>
                    <Text style={styles.heading}>{t('collection.suggestedReply')}</Text>
                    <Text style={styles.text}>{item.content.suggestedReply}</Text>
                  </>
                ) : null}
              </View>
              <View style={styles.card}>
                <View style={styles.row}>
                  {(['all', 'customer', 'sales'] as const).map((role) => {
                    const turns = item.content.turns.filter((turn) => role === 'all' || turn.role === role);
                    const label = t(
                      role === 'all'
                        ? 'collection.playAll'
                        : role === 'customer'
                          ? 'collection.playCustomer'
                          : 'collection.playSales',
                    );
                    return (
                      <CollectionAudioControl
                        key={role}
                        label={label}
                        playing={audio.control === role && playback.isPlaying}
                        disabled={!turns.length || turns.some((turn) => !audio.available(turn))}
                        onPress={() => audio.toggle(role, turns)}
                      />
                    );
                  })}
                </View>
              </View>
              {item.content.turns.map((turn) => {
                const media = item.media.find((v) => v.segmentId === turn.segmentId);
                const active = audio.turnId === turn.segmentId ||
                  (!audio.turnId && turn.segmentId === item.content.turns[0]?.segmentId);
                return (
                  <View key={turn.segmentId} style={styles.card}>
                    <Text style={styles.heading}>
                      {t(`collection.${turn.role}`)} · {turn.speakerLabel}
                    </Text>
                    <Text style={styles.transcript}>{turn.text}</Text>
                    {turn.role === 'unknown' ? (
                      <Text style={styles.hint}>{t('collection.roleUnknown')}</Text>
                    ) : null}
                    {media?.message ? <Text style={styles.hint}>{media.message}</Text> : null}
                    {['candidate', 'published'].includes(item.status) ? (
                      <CollectionAudioControl
                        label={t(item.status === 'candidate' ? 'collection.playSource' : 'collection.playTurn')}
                        range={`${caseTime(turn.startMs)}–${caseTime(turn.endMs)}`}
                        playing={audio.turnId === turn.segmentId && playback.isPlaying}
                        disabled={!audio.available(turn)}
                        onPress={() => audio.toggle(turn.segmentId, [turn])}
                        loading={active && playback.isBuffering}
                        error={active && playback.error ? t('collection.playFailed') : undefined}
                        onRetry={audio.retry}
                      />
                    ) : null}
                  </View>
                );
              })}
            </>
          )}
        </>
      ) : null}
    </CollectionLayout>
  );
}
