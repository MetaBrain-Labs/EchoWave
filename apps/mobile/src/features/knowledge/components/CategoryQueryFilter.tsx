/**
 * 问答类别筛选面板。
 *
 * 延迟读取当前知识库可检索类别，支持自动路由与最多三个显式类别。
 *
 * Responsibilities:
 * - 显式筛选只作为每轮请求草稿，不成为本地业务权威数据。
 *
 * Notes:
 * - 发送中禁止改变筛选，失败重试由页面保留原轮次筛选。
 */
import type { KnowledgeCategory } from '@echowave/contracts';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, radii, spacing } from '@/shared/theme/tokens';
import { listRetrievalCategories } from '../apiClient';
import { CategoryPicker } from './CategoryPicker';

/** 自动路由和显式筛选共存；目录加载失败提供明确重试。 */
export function CategoryQueryFilter({
  knowledgeId,
  selected,
  onChange,
  disabled,
}: {
  knowledgeId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useAppLanguage();
  const [visible, setVisible] = useState(false);
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setCategories((await listRetrievalCategories(knowledgeId)).items);
    } catch {
      setError(t('knowledgeCategory.loadFailed'));
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        style={styles.button}
        onPress={() => {
          setVisible(true);
          void load();
        }}
      >
        <Text>
          {t('knowledgeCategory.filter')}:{' '}
          {selected.length
            ? selected
                .map((id) => categories.find((item) => item.id === id)?.name ?? id)
                .join(' / ')
            : t('knowledgeCategory.auto')}
        </Text>
      </Pressable>
      <Modal transparent visible={visible} onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay} accessibilityViewIsModal>
          <ScrollView
            style={styles.sheet}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text accessibilityRole="header">{t('knowledgeCategory.filter')}</Text>
            <Text>{t('knowledgeCategory.limit')}</Text>
            {loading ? <Text>{t('documentActions.processing')}</Text> : null}
            <CategoryPicker
              categories={categories}
              selected={selected}
              onChange={onChange}
              multiple
              emptyLabel={t('knowledgeCategory.auto')}
              disabled={disabled || loading}
            />
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={() => void load()}
              style={styles.button}
            >
              <Text>{t('knowledgeCategory.refresh')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
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
  button: { padding: spacing.sm, minHeight: 48, justifyContent: 'center' },
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
});
