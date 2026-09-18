/**
 * 知识库全屏编辑页面。
 *
 * 将知识库名称、默认类别和类别管理拆成三个清晰区域，避免在详情页中嵌套长弹层。
 *
 * Responsibilities:
 * - 保存知识库名称与默认类别的编辑草稿。
 * - 提供进入独立类别管理页面的入口。
 * - 通过固定底部操作栏保持取消与保存始终可达。
 *
 * Notes:
 * - 类别目录和版本仍由现有 API 提供，本页面不改变分类业务规则。
 */
import type { KnowledgeBaseDetail, KnowledgeCategory } from '@echowave/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getKnowledgeBase, listKnowledgeCategories, updateKnowledgeBase } from '../apiClient';
import { CategoryPicker } from '../components/CategoryPicker';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { PageHeader } from '@/shared/ui/PageHeader';
import { colors, spacing, textColors, typography } from '@/shared/theme/tokens';
import { textInputText } from '@/shared/theme/textInput';

type KnowledgeBaseEditScreenProps = {
  knowledge: KnowledgeBaseDetail;
  onBack: () => void;
  onManageCategories: () => void;
  onSaved: () => void | Promise<void>;
};

/** 渲染知识库的全屏编辑表单。 */
export function KnowledgeBaseEditScreen({
  knowledge,
  onBack,
  onManageCategories,
  onSaved,
}: KnowledgeBaseEditScreenProps) {
  const { t } = useAppLanguage();
  const [name, setName] = useState(knowledge.name);
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [categoryId, setCategoryId] = useState(knowledge.defaultCategoryId ?? '');
  const [categoryVersion, setCategoryVersion] = useState(knowledge.categoryVersion ?? 0);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const loadCategories = useCallback(async () => {
    setLoadingCategories(true);
    try {
      const [catalogue, latest] = await Promise.all([
        listKnowledgeCategories(),
        getKnowledgeBase(knowledge.id),
      ]);
      setCategories(catalogue.items);
      setCategoryVersion(latest.categoryVersion ?? 0);
      setCategoryId(
        (current) =>
          current ||
          latest.defaultCategoryId ||
          catalogue.items.find((item) => item.active)?.id ||
          '',
      );
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('knowledgeCategory.loadFailed'));
    } finally {
      setLoadingCategories(false);
    }
  }, [knowledge.id, t]);

  useFocusEffect(
    useCallback(() => {
      void loadCategories();
    }, [loadCategories]),
  );

  const save = async () => {
    if (pending || !name.trim() || !categoryId) return;
    setPending(true);
    setError('');
    try {
      await updateKnowledgeBase(knowledge.id, name.trim(), knowledge.description, {
        defaultCategoryId: categoryId,
        expectedCategoryVersion: categoryVersion,
      });
      await onSaved();
      onBack();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('common.saveFailed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
      <PageHeader onBack={onBack} title={t('knowledgeCategory.editBaseTitle')} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('knowledgeEdit.baseName')}</Text>
          <TextInput
            accessibilityLabel={t('knowledgeEdit.baseName')}
            editable={!pending}
            maxLength={120}
            onChangeText={setName}
            placeholder={t('knowledgeEdit.baseName')}
            style={styles.input}
            value={name}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('knowledgeCategory.categorySection')}</Text>
          <View style={styles.guide}>
            <Text style={styles.guideTitle}>{t('knowledgeCategory.editGuide')}</Text>
          </View>
          {loadingCategories ? (
            <Text style={styles.muted}>{t('documentActions.processing')}</Text>
          ) : null}
          <CategoryPicker
            categories={categories}
            disabled={pending || loadingCategories}
            onChange={(ids) => setCategoryId(ids[0] ?? '')}
            selected={categoryId ? [categoryId] : []}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={onManageCategories}
          style={({ pressed }) => [styles.manageRow, pressed && styles.pressed]}
        >
          <View style={styles.manageCopy}>
            <Text style={styles.manageTitle}>{t('knowledgeCategory.manageEntry')}</Text>
            <Text style={styles.muted}>{t('knowledgeCategory.manageEntryHint')}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.actionBar}>
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={onBack}
          style={styles.cancelButton}
        >
          <Text style={styles.cancelText}>{t('knowledgeCategory.cancelChanges')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={pending || !name.trim() || !categoryId}
          onPress={() => void save()}
          style={[styles.saveButton, (pending || !name.trim() || !categoryId) && styles.disabled]}
        >
          <Text style={styles.saveText}>{t('knowledgeCategory.saveChanges')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.lg, padding: spacing.md, paddingBottom: 120 },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.heading3, color: textColors.primary, fontWeight: '700' },
  input: {
    ...textInputText,
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: 10,
    borderWidth: 1,
    color: textColors.primary,
    height: 48,
    paddingHorizontal: spacing.md,
    ...typography.body,
  },
  guide: { backgroundColor: colors.primarySurface, borderRadius: 10, padding: spacing.md },
  guideTitle: { ...typography.description, color: colors.primary, lineHeight: 20 },
  muted: { ...typography.description, color: textColors.secondary },
  manageRow: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  manageCopy: { flex: 1, gap: 2 },
  manageTitle: { ...typography.body, color: textColors.primary, fontWeight: '700' },
  chevron: { color: textColors.secondary, fontSize: 28, lineHeight: 28 },
  pressed: { opacity: 0.72 },
  error: { ...typography.description, color: colors.danger },
  actionBar: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cancelButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  cancelText: { ...typography.body, color: textColors.secondary, fontWeight: '600' },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flex: 1,
    height: 48,
    justifyContent: 'center',
  },
  saveText: { ...typography.body, color: colors.white, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
