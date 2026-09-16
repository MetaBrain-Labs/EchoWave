/**
 * 知识库类别编辑页面。
 *
 * 在独立页面中维护类别名称、用途说明和启用状态，避免类别编辑表单与知识库默认类别选择混杂。
 *
 * Responsibilities:
 * - 加载并保存现有类别，或创建新的自定义类别。
 * - 保留服务端版本字段，沿用现有并发冲突检查。
 * - 为测试样例和不可停用的通用资料提供必要的辅助说明。
 *
 * Notes:
 * - 当前业务没有硬删除类别接口，因此页面不展示删除操作，历史归属通过停用保留。
 */
import type { KnowledgeCategory } from '@echowave/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  createKnowledgeCategory,
  listKnowledgeCategories,
  updateKnowledgeCategory,
} from '../apiClient';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { PageHeader } from '@/shared/ui/PageHeader';
import { colors, spacing, textColors, typography } from '@/shared/theme/tokens';

type CategoryEditScreenProps = {
  categoryId: string;
  onBack: () => void;
  onSaved: () => void | Promise<void>;
};

/** 渲染单个类别的新增或编辑表单。 */
export function CategoryEditScreen({ categoryId, onBack, onSaved }: CategoryEditScreenProps) {
  const { t } = useAppLanguage();
  const isNew = categoryId === 'new';
  const [category, setCategory] = useState<KnowledgeCategory>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(!isNew);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    try {
      const item = (await listKnowledgeCategories()).items.find((entry) => entry.id === categoryId);
      if (!item) {
        setError(t('knowledgeCategory.noCategories'));
        return;
      }
      setCategory(item);
      setName(item.name);
      setDescription(item.description);
      setActive(item.active);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('knowledgeCategory.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [categoryId, isNew, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const save = async () => {
    if (pending || (!isNew && !category) || !name.trim() || !description.trim()) return;
    setPending(true);
    setError('');
    try {
      if (category) {
        await updateKnowledgeCategory(category.id, {
          active,
          description: description.trim(),
          expectedVersion: category.version,
          name: name.trim(),
        });
      } else {
        await createKnowledgeCategory({ description: description.trim(), name: name.trim() });
      }
      await onSaved();
      onBack();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('common.saveFailed'));
    } finally {
      setPending(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
        <PageHeader onBack={onBack} title={t('knowledgeCategory.editCategoryTitle')} />
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
      <PageHeader
        onBack={onBack}
        title={isNew ? t('knowledgeCategory.add') : t('knowledgeCategory.editCategoryTitle')}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.label}>{t('knowledgeCategory.name')}</Text>
          <TextInput
            accessibilityLabel={t('knowledgeCategory.name')}
            editable={!pending}
            maxLength={80}
            onChangeText={setName}
            placeholder={t('knowledgeCategory.name')}
            style={styles.input}
            value={name}
          />
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>{t('knowledgeCategory.description')}</Text>
          <TextInput
            accessibilityLabel={t('knowledgeCategory.description')}
            editable={!pending}
            maxLength={1000}
            multiline
            onChangeText={setDescription}
            placeholder={t('knowledgeCategory.description')}
            style={[styles.input, styles.descriptionInput]}
            textAlignVertical="top"
            value={description}
          />
          {category?.key === 'test' ? (
            <Text style={styles.helper}>{t('knowledgeCategory.testHint')}</Text>
          ) : null}
        </View>
        <View style={styles.statusRow}>
          <View style={styles.statusCopy}>
            <Text style={styles.label}>{t('knowledgeCategory.status')}</Text>
            <Text style={styles.muted}>
              {active ? t('knowledgeCategory.enable') : t('knowledgeCategory.disabled')}
            </Text>
          </View>
          <Switch
            accessibilityLabel={t('knowledgeCategory.status')}
            disabled={pending || category?.key === 'general'}
            onValueChange={setActive}
            trackColor={{ false: colors.divider, true: colors.primaryBorder }}
            value={active}
            thumbColor={active ? colors.primary : colors.white}
          />
        </View>
        {category?.key === 'general' ? (
          <Text style={styles.muted}>{t('knowledgeCategory.keepHistory')}</Text>
        ) : null}
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
          disabled={pending || (!isNew && !category) || !name.trim() || !description.trim()}
          onPress={() => void save()}
          style={[
            styles.saveButton,
            (pending || (!isNew && !category) || !name.trim() || !description.trim()) &&
              styles.disabled,
          ]}
        >
          <Text style={styles.saveText}>{t('knowledgeCategory.saveChanges')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  loading: { marginTop: spacing.xl },
  content: { gap: spacing.lg, padding: spacing.md, paddingBottom: 120 },
  section: { gap: spacing.sm },
  label: { ...typography.body, color: textColors.primary, fontWeight: '700' },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: 10,
    borderWidth: 1,
    color: textColors.primary,
    height: 48,
    paddingHorizontal: spacing.md,
    ...typography.body,
  },
  descriptionInput: { height: 112, paddingTop: spacing.md },
  helper: { ...typography.description, color: colors.primary },
  muted: { ...typography.description, color: textColors.secondary },
  statusRow: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 72,
    paddingHorizontal: spacing.md,
  },
  statusCopy: { gap: spacing.xs },
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
