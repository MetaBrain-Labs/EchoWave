/**
 * 知识库名称及描述编辑。
 *
 * 仅编辑已有 metadata，不触发解析或 embedding。
 *
 * Responsibilities:
 * - 使用跨平台弹层校验输入并提交服务器。
 *
 * Notes:
 * - 保存失败保留输入，不保存本地权威副本。
 */
import type { KnowledgeBaseDetail, KnowledgeCategory } from '@echowave/contracts';
import { useState, useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, radii, spacing, typography } from '@/shared/theme/tokens';
import { updateKnowledgeBase, listKnowledgeCategories, getKnowledgeBase } from '../apiClient';
import { CategoryPicker } from './CategoryPicker';
import { CategoryManager } from './CategoryManager';
/** 编辑已有知识库 metadata。 */
type KnowledgeBaseEditorProps = {
  knowledge: KnowledgeBaseDetail;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

/** 关闭时丢弃编辑草稿，重新打开时从服务器 metadata 初始化。 */
export function KnowledgeBaseEditor(props: KnowledgeBaseEditorProps) {
  return props.visible ? <KnowledgeBaseEditorSession key={props.knowledge.id} {...props} /> : null;
}

/** 提交本次知识库编辑会话。 */
function KnowledgeBaseEditorSession({
  knowledge,
  visible,
  onClose,
  onSaved,
}: KnowledgeBaseEditorProps) {
  const { t } = useAppLanguage();
  const [name, setName] = useState(knowledge.name);
  const [description, setDescription] = useState(knowledge.description);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [categoryId, setCategoryId] = useState(knowledge.defaultCategoryId ?? undefined);
  const [categoryVersion, setCategoryVersion] = useState(knowledge.categoryVersion ?? 0);
  const [categoryError, setCategoryError] = useState('');
  const loadCategories = async () => {
    try {
      const result = await listKnowledgeCategories();
      setCategories(result?.items ?? []);
      setCategoryError('');
    } catch {
      setCategoryError(t('knowledgeCategory.loadFailed'));
    }
  };
  useEffect(() => {
    let active = true;
    // 目录返回后才更新状态，关闭编辑会话后不再写入卸载组件。
    void listKnowledgeCategories()
      .then((result) => {
        if (active) setCategories(result?.items ?? []);
      })
      .catch(() => {
        if (active) setCategoryError(t('knowledgeCategory.loadFailed'));
      });
    return () => {
      active = false;
    };
  }, [t]);
  const refreshCategories = async () => {
    await loadCategories();
    const latest = await getKnowledgeBase(knowledge.id);
    setCategoryVersion(latest.categoryVersion ?? 0);
  };
  const save = async () => {
    if (pending || !name.trim()) return;
    setPending(true);
    setError('');
    try {
      if (categoryId && categoryId !== knowledge.defaultCategoryId)
        await updateKnowledgeBase(knowledge.id, name.trim(), description, {
          defaultCategoryId: categoryId,
          expectedCategoryVersion: categoryVersion,
        });
      else await updateKnowledgeBase(knowledge.id, name.trim(), description);
      await onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('common.saveFailed'));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      transparent
      visible={visible}
      onRequestClose={() => {
        if (!pending) onClose();
      }}
    >
      <View style={styles.overlay} accessibilityViewIsModal>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={styles.sheet}
          contentContainerStyle={styles.content}
        >
          <Text accessibilityRole="header" style={styles.heading}>
            {t('knowledgeEdit.base')}
          </Text>
          <TextInput
            accessibilityLabel={t('knowledgeEdit.baseName')}
            autoFocus
            editable={!pending}
            maxLength={120}
            value={name}
            onChangeText={setName}
            style={styles.input}
          />
          <Text>{t('knowledgeCategory.default')}</Text>
          <CategoryPicker
            categories={categories}
            selected={categoryId ? [categoryId] : []}
            onChange={(ids) => setCategoryId(ids[0])}
            disabled={pending}
          />
          {categoryError ? <Text accessibilityRole="alert">{categoryError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={() =>
              void refreshCategories().catch(() =>
                setCategoryError(t('knowledgeCategory.loadFailed')),
              )
            }
            style={styles.button}
          >
            <Text>{t('knowledgeCategory.refresh')}</Text>
          </Pressable>
          <CategoryManager
            categories={categories}
            onChanged={refreshCategories}
            disabled={pending}
          />
          <TextInput
            accessibilityLabel={t('knowledgeEdit.description')}
            editable={!pending}
            multiline
            maxLength={1000}
            value={description}
            onChangeText={setDescription}
            style={styles.input}
          />
          {error ? <Text accessibilityRole="alert">{error}</Text> : null}
          <View style={styles.buttons}>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onClose}
              style={styles.button}
            >
              <Text>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={pending || !name.trim()}
              onPress={() => void save()}
              style={styles.button}
            >
              <Text>{pending ? t('documentActions.processing') : t('common.confirm')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
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
  content: { padding: spacing.md, gap: spacing.md },
  heading: { ...typography.heading2 },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.sm,
    minHeight: 48,
  },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  button: { padding: spacing.sm, minHeight: 48, justifyContent: 'center' },
});
