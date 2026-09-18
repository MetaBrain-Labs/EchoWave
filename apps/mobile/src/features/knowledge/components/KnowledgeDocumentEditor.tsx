/**
 * 知识文档修改和删除交互。
 *
 * 使用共享版本契约提交改名、替换和确认删除，并在不确定网络结果后读取服务器状态。
 *
 * Responsibilities:
 * - 在列表及详情复用跨平台操作抽屉和确认弹层。
 * - 防止重复请求，保留失败输入并刷新版本冲突。
 *
 * Notes:
 * - 不在本地修改知识内容或保存原文件。
 */
import type { KnowledgeDocument } from '@echowave/contracts';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { pickDocumentAsync } from '@/shared/files/documentPicker';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { textInputText } from '@/shared/theme/textInput';
import {
  deleteDocument,
  getDocument,
  renameDocument,
  retryDocument,
  uploadDocument,
} from '../apiClient';
import { KnowledgeDocumentActions } from './KnowledgeDocumentActions';

/** 文档操作入口，处理中也可以用读取后的新 version 提交更新。 */
type DocumentEditorProps = {
  document?: KnowledgeDocument;
  knowledgeId: string;
  onClose: () => void;
  onOpen: () => void;
  onChanged: () => void | Promise<void>;
  onDeleted?: () => void;
};

/** 每次打开独立编辑会话，关闭时释放输入及请求状态。 */
export function KnowledgeDocumentEditor(props: DocumentEditorProps) {
  return props.document ? (
    <DocumentEditorSession key={`${props.document.id}:${props.document.version}`} {...props} />
  ) : null;
}

/** 在编辑会话内保存用户输入与已确认服务器版本。 */
function DocumentEditorSession({
  document: initialDocument,
  knowledgeId,
  onClose,
  onOpen,
  onChanged,
  onDeleted,
}: DocumentEditorProps) {
  const { t } = useAppLanguage();
  const [document, setDocument] = useState(initialDocument);
  const [mode, setMode] = useState<'rename' | 'delete' | 'failure' | 'retry' | 'reupload'>();
  const [title, setTitle] = useState(
    initialDocument?.latestRevision?.title ?? initialDocument?.title ?? '',
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const run = async (
    action: () => Promise<unknown>,
    deleting = false,
    verification?: { kind: 'rename'; title: string } | { kind: 'replace' | 'retry' },
  ) => {
    if (pending || !document) return;
    setPending(true);
    setError('');
    try {
      await action();
      await onChanged();
      onClose();
      if (deleting) onDeleted?.();
    } catch (reason) {
      const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : '';
      if (code === 'CONFLICT' || code === 'TIMEOUT' || code === 'NETWORK') {
        try {
          const server = await getDocument(knowledgeId, document.id);
          setDocument(server);
          await onChanged();
          // 不确定网络结果先确认服务器已推进版本，避免把同一修改再次提交。
          const advanced = (server.version ?? 0) > (document.version ?? 0);
          const accepted =
            code !== 'CONFLICT' &&
            verification &&
            (verification.kind === 'rename'
              ? advanced && (server.latestRevision?.title ?? server.title) === verification.title
              : verification.kind === 'replace'
                ? advanced
                : ['queued', 'running'].includes(server.latestRevision?.status ?? ''));
          if (accepted) {
            onClose();
            return;
          }
          setError(t(code === 'CONFLICT' ? 'knowledgeEdit.conflict' : 'knowledgeEdit.uncertain'));
        } catch (readError) {
          if (
            deleting &&
            readError &&
            typeof readError === 'object' &&
            'code' in readError &&
            readError.code === 'NOT_FOUND'
          ) {
            await onChanged();
            onClose();
            onDeleted?.();
            return;
          }
          setError(t('knowledgeEdit.uncertain'));
        }
      } else setError(reason instanceof Error ? reason.message : t('common.saveFailed'));
    } finally {
      setPending(false);
    }
  };
  const replace = async () => {
    if (!document || pending) return;
    await run(
      async () => {
        const selection = await pickDocumentAsync({
          type: [
            'text/markdown',
            'text/plain',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (!selection || selection.canceled) return;
        await uploadDocument(knowledgeId, selection.assets[0]!, {
          documentId: document.id,
          expectedVersion: document.version ?? 0,
        });
      },
      false,
      { kind: 'replace' },
    );
  };
  return (
    <>
      {!mode && (
        <KnowledgeDocumentActions
          document={document}
          pending={pending}
          onClose={onClose}
          onOpen={onOpen}
          onRename={() => setMode('rename')}
          onReplace={() => void replace()}
          onDelete={() => setMode('delete')}
          onRetry={() => setMode('retry')}
          onReupload={() => setMode('reupload')}
          onShowFailure={() => setMode('failure')}
          error={error}
        />
      )}
      <Modal
        transparent
        visible={Boolean(document && mode)}
        onRequestClose={() => {
          if (!pending) setMode(undefined);
        }}
      >
        <View style={styles.overlay} accessibilityViewIsModal>
          <View style={styles.sheet}>
            <Text accessibilityRole="header" style={styles.heading}>
              {t(
                mode === 'delete'
                  ? 'knowledgeEdit.delete'
                  : mode === 'failure'
                    ? 'documentActions.failure'
                    : mode === 'retry'
                      ? 'documentDetail.reparse'
                      : mode === 'reupload'
                        ? 'documentActions.reupload'
                        : 'knowledgeEdit.rename',
              )}
            </Text>
            {mode === 'rename' ? (
              <>
                <Text style={styles.text}>{t('knowledgeEdit.renameHint')}</Text>
                <TextInput
                  accessibilityLabel={t('knowledgeEdit.fileName')}
                  autoFocus
                  editable={!pending}
                  maxLength={255}
                  value={title}
                  onChangeText={setTitle}
                  style={styles.input}
                />
              </>
            ) : (
              <Text selectable style={styles.text}>
                {mode === 'delete'
                  ? t('knowledgeEdit.deleteHint', { title: document?.title ?? '' })
                  : mode === 'retry' || mode === 'reupload'
                    ? t('knowledgeEdit.retryHint')
                    : (document?.latestRevision?.error?.message ??
                      (document?.status.kind === 'failed' ? document.status.message : ''))}
              </Text>
            )}
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <View style={styles.buttons}>
              <Pressable
                accessibilityRole="button"
                disabled={pending}
                onPress={() => setMode(undefined)}
                style={styles.button}
              >
                <Text>{t('common.cancel')}</Text>
              </Pressable>
              {mode !== 'failure' && (
                <Pressable
                  accessibilityRole="button"
                  disabled={pending || (mode === 'rename' && !title.trim())}
                  onPress={() => {
                    if (mode === 'reupload') {
                      void replace();
                      return;
                    }
                    void run(
                      () =>
                        mode === 'retry'
                          ? retryDocument(knowledgeId, document!.id)
                          : mode === 'delete'
                            ? deleteDocument(knowledgeId, document!.id)
                            : renameDocument(
                                knowledgeId,
                                document!.id,
                                title.trim(),
                                document!.version ?? 0,
                              ),
                      mode === 'delete',
                      mode === 'retry'
                        ? { kind: 'retry' }
                        : mode === 'rename'
                          ? { kind: 'rename', title: title.trim() }
                          : undefined,
                    );
                  }}
                  style={styles.button}
                >
                  <Text>{pending ? t('documentActions.processing') : t('common.confirm')}</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(16,24,40,0.28)',
    padding: spacing.md,
  },
  sheet: {
    backgroundColor: colors.white,
    borderRadius: radii.default,
    padding: spacing.md,
    width: '100%',
    maxWidth: 480,
    gap: spacing.md,
  },
  heading: { ...typography.heading2, color: textColors.primary },
  text: { ...typography.body, color: textColors.secondary },
  input: {
    ...textInputText,
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radii.default,
    padding: spacing.sm,
    height: 48,
  },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  button: { padding: spacing.sm, minHeight: 48, justifyContent: 'center' },
  error: { ...typography.body, color: '#b42318' },
});
