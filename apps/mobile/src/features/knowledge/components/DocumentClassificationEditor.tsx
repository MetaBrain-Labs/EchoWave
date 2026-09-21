/**
 * 文档与工作表分类编辑面板。
 *
 * 展示当前生效覆盖、未确认建议及工作表继承，按服务器版本确认修改。
 *
 * Responsibilities:
 * - 失败保留草稿，显式刷新后才重置为服务器数据。
 * - 建议确认和手动覆盖均不触发 embedding。
 * - 保持类别内容独立滚动，并将主要操作固定在弹层底部。
 *
 * Notes:
 * - 默认关闭，打开后才请求分类数据。
 */
import type { DocumentClassification, KnowledgeCategory } from '@echowave/contracts';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import {
  getDocumentClassification,
  listKnowledgeCategories,
  suggestDocumentClassification,
  updateDocumentClassification,
} from '../apiClient';
import { CategoryPicker } from './CategoryPicker';

function FooterAction({
  disabled,
  emphasized = false,
  icon,
  label,
  onPress,
}: {
  disabled: boolean;
  emphasized?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.footerAction,
        emphasized && styles.emphasizedFooterAction,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={colors.ink} name={icon} size={typography.body.lineHeight} />
      <Text style={styles.footerActionText}>{label}</Text>
    </Pressable>
  );
}

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
        accessibilityLabel={t('knowledgeCategory.title')}
        onPress={() => {
          setVisible(true);
          void load();
        }}
        style={({ pressed }) => [styles.entryButton, pressed && styles.pressed]}
        testID="document-classification-entry"
      >
        <View style={styles.entryMain}>
          <Ionicons
            color={colors.ink}
            name="pricetags-outline"
            size={typography.heading2.lineHeight}
          />
          <View style={styles.entryCopy}>
            <Text style={styles.entryTitle}>{t('knowledgeCategory.title')}</Text>
            <Text numberOfLines={1} style={styles.entryValue}>
              {classification
                ? name(classification.documentCategoryId ?? classification.defaultCategoryId)
                : t('knowledgeCategory.hint')}
            </Text>
          </View>
        </View>
        <Ionicons color={textColors.tertiary} name="chevron-forward" size={24} />
      </Pressable>
      <Modal
        transparent
        visible={visible}
        onRequestClose={() => {
          if (!pending) setVisible(false);
        }}
      >
        <View style={styles.overlay} accessibilityViewIsModal>
          <View style={styles.sheet}>
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.heading}>
                {t('knowledgeCategory.title')}
              </Text>
              <Text style={styles.hint}>{t('knowledgeCategory.hint')}</Text>
              {loading || pending ? (
                <Text style={styles.processing}>{t('documentActions.processing')}</Text>
              ) : null}
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.scrollArea}
              contentContainerStyle={styles.content}
              testID="document-classification-scroll"
            >
              {classification ? (
                <>
                  <Text style={styles.bodyText}>
                    {t('knowledgeCategory.default')}: {name(classification.defaultCategoryId)}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={pending || loading}
                    onPress={() => setTarget({ kind: 'document' })}
                    style={({ pressed }) => [styles.selectorButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.selectorText}>
                      {t('knowledgeCategory.document')}: {name(documentCategoryId)}
                    </Text>
                  </Pressable>
                  {classification.sheets.map((sheet) => (
                    <Pressable
                      accessibilityRole="button"
                      key={sheet}
                      disabled={pending || loading}
                      onPress={() => setTarget({ kind: 'sheet', sheet })}
                      style={({ pressed }) => [styles.selectorButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.selectorText}>
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
                            style={({ pressed }) => [
                              styles.inlineAction,
                              (pending || loading) && styles.disabled,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Ionicons
                              color={colors.ink}
                              name="checkmark-circle-outline"
                              size={typography.body.lineHeight}
                            />
                            <Text style={styles.footerActionText}>
                              {t('knowledgeCategory.confirm')}
                            </Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  ) : null}
                </>
              ) : null}
            </ScrollView>
            <View style={styles.footer} testID="document-classification-footer">
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              <View style={styles.footerRow}>
                <FooterAction
                  disabled={pending || loading || !classification}
                  icon="sparkles-outline"
                  label={t('knowledgeCategory.suggest')}
                  onPress={() => void suggest()}
                />
                <FooterAction
                  disabled={pending || loading}
                  icon="refresh-outline"
                  label={t('knowledgeCategory.refresh')}
                  onPress={() => void load()}
                />
              </View>
              <View style={styles.footerRow}>
                <FooterAction
                  disabled={pending}
                  icon="close-outline"
                  label={t('common.close')}
                  onPress={() => setVisible(false)}
                />
                <FooterAction
                  disabled={pending || loading || !classification}
                  emphasized
                  icon="save-outline"
                  label={t('knowledgeCategory.save')}
                  onPress={() => void save()}
                />
              </View>
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
    overflow: 'hidden',
  },
  modalHeader: {
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    padding: spacing.md,
  },
  scrollArea: { flexShrink: 1 },
  content: { gap: spacing.sm, padding: spacing.md },
  heading: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  hint: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  processing: { ...typography.description, color: colors.success, fontFamily: fontFamilies.sans },
  bodyText: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  entryButton: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  entryMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm },
  entryCopy: { flex: 1, gap: spacing.xs },
  entryTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  entryValue: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  selectorButton: {
    backgroundColor: colors.canvas,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  selectorText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  proposal: {
    backgroundColor: colors.primarySurface,
    borderColor: colors.primaryBorder,
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  inlineAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  footer: {
    backgroundColor: colors.card,
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  footerAction: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  emphasizedFooterAction: { borderColor: colors.ink, borderWidth: 2 },
  footerActionText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  error: { ...typography.description, color: colors.danger, fontFamily: fontFamilies.sans },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: colors.background },
});
