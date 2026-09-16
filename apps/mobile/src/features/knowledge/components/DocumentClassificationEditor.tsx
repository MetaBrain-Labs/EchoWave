/**
 * 文档与工作表分类编辑面板。
 *
 * 展示当前生效覆盖、未确认建议及工作表继承，按服务器版本确认修改。
 *
 * Responsibilities:
 * - 失败保留草稿，显式刷新后才重置为服务器数据。
 * - 建议确认和手动覆盖均不触发 embedding。
 *
 * Notes:
 * - 默认关闭，打开后才请求分类数据。
 */
import type { DocumentClassification, KnowledgeCategory } from '@echowave/contracts';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, radii, spacing, typography } from '@/shared/theme/tokens';
import {
  getDocumentClassification,
  listKnowledgeCategories,
  suggestDocumentClassification,
  updateDocumentClassification,
} from '../apiClient';
import { CategoryPicker } from './CategoryPicker';

/** 安全管理活动 revision 的文档与工作表分类。 */
export function DocumentClassificationEditor({
  knowledgeId,
  documentId,
  onChanged,
}: {
  knowledgeId: string;
  documentId: string;
  onChanged: () => Promise<void>;
}) {
  const { t } = useAppLanguage();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [classification, setClassification] = useState<DocumentClassification>();
  const [documentCategoryId, setDocumentCategoryId] = useState<string | null>(null);
  const [sheetCategories, setSheetCategories] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<{ kind: 'document' } | { kind: 'sheet'; sheet: string }>({
    kind: 'document',
  });
  const apply = (value: DocumentClassification) => {
    setClassification(value);
    setDocumentCategoryId(value.documentCategoryId);
    setSheetCategories(
      Object.fromEntries(value.sheetAssignments.map((item) => [item.sheet, item.categoryId])),
    );
  };
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [catalogue, value] = await Promise.all([
        listKnowledgeCategories(),
        getDocumentClassification(knowledgeId, documentId),
      ]);
      setCategories(catalogue.items);
      apply(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('knowledgeCategory.loadFailed'));
    } finally {
      setLoading(false);
    }
  };
  const name = (id?: string | null) =>
    categories.find((item) => item.id === id)?.name ?? t('knowledgeCategory.inherit');
  const save = async (confirmSuggestion = false) => {
    if (!classification || pending) return;
    setPending(true);
    setError('');
    try {
      const proposal = confirmSuggestion ? classification.suggestion : undefined;
      const result = await updateDocumentClassification(knowledgeId, documentId, {
        revisionId: classification.revisionId,
        expectedVersion: classification.version,
        expectedDocumentVersion: classification.documentVersion,
        documentCategoryId: proposal ? proposal.documentCategoryId : documentCategoryId,
        sheetAssignments: proposal
          ? proposal.sheets
          : Object.entries(sheetCategories).map(([sheet, categoryId]) => ({ sheet, categoryId })),
        confirmSuggestion,
      });
      apply(result);
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('common.saveFailed'));
    } finally {
      setPending(false);
    }
  };
  const suggest = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      apply(await suggestDocumentClassification(knowledgeId, documentId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('common.saveFailed'));
    } finally {
      setPending(false);
    }
  };
  const selected = target.kind === 'document' ? documentCategoryId : sheetCategories[target.sheet];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setVisible(true);
          void load();
        }}
        style={styles.button}
      >
        <Text>
          {t('knowledgeCategory.title')}
          {classification
            ? ` · ${name(classification.documentCategoryId ?? classification.defaultCategoryId)}`
            : ''}
        </Text>
      </Pressable>
      <Modal
        transparent
        visible={visible}
        onRequestClose={() => {
          if (!pending) setVisible(false);
        }}
      >
        <View style={styles.overlay} accessibilityViewIsModal>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.sheet}
            contentContainerStyle={styles.content}
          >
            <Text accessibilityRole="header" style={styles.heading}>
              {t('knowledgeCategory.title')}
            </Text>
            <Text>{t('knowledgeCategory.hint')}</Text>
            {loading || pending ? <Text>{t('documentActions.processing')}</Text> : null}
            {classification ? (
              <>
                <Text>
                  {t('knowledgeCategory.default')}: {name(classification.defaultCategoryId)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={pending || loading}
                  onPress={() => setTarget({ kind: 'document' })}
                  style={styles.button}
                >
                  <Text>
                    {t('knowledgeCategory.document')}: {name(documentCategoryId)}
                  </Text>
                </Pressable>
                {classification.sheets.map((sheet) => (
                  <Pressable
                    accessibilityRole="button"
                    key={sheet}
                    disabled={pending || loading}
                    onPress={() => setTarget({ kind: 'sheet', sheet })}
                    style={styles.button}
                  >
                    <Text>
                      {sheet}:{' '}
                      {sheetCategories[sheet]
                        ? name(sheetCategories[sheet])
                        : `${t('knowledgeCategory.inherit')} · ${name(documentCategoryId ?? classification.defaultCategoryId)}`}
                    </Text>
                  </Pressable>
                ))}
                <Text style={styles.heading}>
                  {target.kind === 'document' ? t('knowledgeCategory.document') : target.sheet}
                </Text>
                <CategoryPicker
                  categories={categories}
                  selected={selected ? [selected] : []}
                  emptyLabel={t('knowledgeCategory.inherit')}
                  disabled={pending || loading}
                  onChange={(ids) => {
                    if (target.kind === 'document') setDocumentCategoryId(ids[0] ?? null);
                    else
                      setSheetCategories((current) => {
                        const next = { ...current };
                        if (ids[0]) next[target.sheet] = ids[0];
                        else delete next[target.sheet];
                        return next;
                      });
                  }}
                />
                {classification.suggestion ? (
                  <View style={styles.proposal}>
                    <Text>
                      {classification.suggestion.status === 'pending'
                        ? t('knowledgeCategory.pending')
                        : classification.suggestion.status === 'confirmed'
                          ? t('knowledgeCategory.confirmed')
                          : classification.suggestion.message}
                    </Text>
                    {classification.suggestion.status === 'pending' ? (
                      <>
                        <Text>
                          {t('knowledgeCategory.document')}:{' '}
                          {name(classification.suggestion.documentCategoryId)}
                        </Text>
                        {classification.suggestion.sheets.map((item) => (
                          <Text key={item.sheet}>
                            {item.sheet}: {name(item.categoryId)}
                          </Text>
                        ))}
                        <Pressable
                          accessibilityRole="button"
                          disabled={pending || loading}
                          onPress={() => void save(true)}
                          style={styles.button}
                        >
                          <Text>{t('knowledgeCategory.confirm')}</Text>
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={pending || loading}
                  onPress={() => void save()}
                  style={styles.button}
                >
                  <Text>{t('knowledgeCategory.save')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={pending || loading}
                  onPress={() => void suggest()}
                  style={styles.button}
                >
                  <Text>{t('knowledgeCategory.suggest')}</Text>
                </Pressable>
              </>
            ) : null}
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={pending || loading}
              onPress={() => void load()}
              style={styles.button}
            >
              <Text>{t('knowledgeCategory.refresh')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={() => setVisible(false)}
              style={styles.button}
            >
              <Text>{t('common.close')}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16,24,40,0.28)',
    padding: spacing.md,
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    backgroundColor: colors.white,
    borderRadius: radii.default,
  },
  content: { padding: spacing.md, gap: spacing.sm },
  heading: { ...typography.heading2 },
  button: { padding: spacing.sm, minHeight: 48, justifyContent: 'center' },
  proposal: { borderWidth: 1, borderColor: colors.divider, padding: spacing.sm, gap: spacing.xs },
});
