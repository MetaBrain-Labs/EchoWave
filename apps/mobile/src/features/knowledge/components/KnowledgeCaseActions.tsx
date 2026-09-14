/**
 * 案例文档操作会话。
 *
 * Responsibilities:
 * - 从案例权威入口审核、编辑和恢复失败阶段。
 * - 不确定结果后显式读取最新状态，保持菜单与输入。
 * Notes:
 * - 不允许替换上传生成文档。
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { KnowledgeCase } from '@echowave/contracts';
import { actOnKnowledgeCase, getKnowledgeCase } from '@/shared/api/collectionApi';
import { ActionSheet } from '@/shared/ui/ActionSheet';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

/** 文档卡片只传递案例身份；版本必须从服务器读取。 */
export function KnowledgeCaseActions({
  caseId,
  onClose,
  onOpen,
  onChanged,
}: {
  caseId: string;
  onClose: () => void;
  onOpen: (editing?: boolean) => void;
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useAppLanguage();
  const [item, setItem] = useState<KnowledgeCase>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const read = useCallback(async () => {
    setBusy(true);
    try {
      setItem(await getKnowledgeCase(caseId));
      setError('');
    } catch {
      setError(t('collection.loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [caseId, t]);
  useEffect(() => {
    void Promise.resolve().then(read);
  }, [read]);
  const run = async (action: 'withdraw' | 'delete' | 'retry') => {
    if (!item || busy) return;
    setBusy(true);
    setError('');
    try {
      setItem(await actOnKnowledgeCase(item.id, item.version, action));
      await onChanged();
      onClose();
    } catch {
      setError(t('collection.menuFailure'));
    } finally {
      setBusy(false);
    }
  };
  const confirm = (action: 'withdraw' | 'delete') =>
    Alert.alert(t(`collection.${action}`), t('collection.removeHint'), [
      { text: t('collection.cancel'), style: 'cancel' },
      { text: t(`collection.${action}`), onPress: () => void run(action) },
    ]);
  return (
    <ActionSheet
      visible
      title={item?.content.title ?? t('collection.openCase')}
      closeLabel={t('collection.cancel')}
      onClose={onClose}
      busy={busy}
      message={
        error ||
        item?.publicationMessage ||
        item?.media.find((media) => media.message)?.message ||
        undefined
      }
      actions={[
        {
          label: t('collection.openCase'),
          icon: 'chatbubbles-outline',
          onPress: () => {
            onClose();
            onOpen();
          },
        },
        ...(['candidate', 'published'].includes(item?.status ?? '')
          ? [
              {
                label: t('collection.edit'),
                icon: 'create-outline' as const,
                onPress: () => {
                  onClose();
                  onOpen(true);
                },
              },
            ]
          : []),
        ...(item?.status === 'published'
          ? [
              {
                label: t('collection.withdraw'),
                icon: 'arrow-undo-outline' as const,
                onPress: () => confirm('withdraw'),
              },
            ]
          : []),
        ...(item && item.status !== 'deleted'
          ? [
              {
                label: t('collection.delete'),
                icon: 'trash-outline' as const,
                onPress: () => confirm('delete'),
              },
            ]
          : []),
        ...(item?.status === 'published' &&
        ((item.publication === 'failed' && item.publicationRetryable !== false) ||
          item.media.some((media) => ['failed', 'missing'].includes(media.status)))
          ? [
              {
                label: t('collection.retry'),
                icon: 'refresh-outline' as const,
                onPress: () => void run('retry'),
              },
            ]
          : []),
        ...(error
          ? [
              {
                label: t('collection.readServerState'),
                icon: 'sync-outline' as const,
                onPress: () => void read(),
              },
            ]
          : []),
      ]}
    />
  );
}
