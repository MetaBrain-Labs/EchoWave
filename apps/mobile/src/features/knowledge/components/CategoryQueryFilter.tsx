/**
 * 问答类别筛选面板。
 *
 * 读取当前知识库可检索类别，支持自动路由与不限数量的显式多选类别；
 * 从分组入口进入时展示默认选中的全部类别。
 *
 * Responsibilities:
 * - 显式筛选只作为每轮请求草稿，不成为本地业务权威数据。
 * - 类别未就绪时给出明确加载状态，而不是回退显示类别 ID。
 *
 * Notes:
 * - 发送中禁止改变筛选，失败重试由页面保留原轮次筛选。
 */
import type { KnowledgeCategory } from '@echowave/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { listRetrievalCategories } from '../apiClient';
import { CategoryPicker } from './CategoryPicker';

const EMPTY_CATEGORIES: KnowledgeCategory[] = [];

/** 自动路由和显式多选筛选共存；目录加载失败提供明确重试。 */
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
  const [categories, setCategories] = useState<KnowledgeCategory[]>(EMPTY_CATEGORIES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** 已按知识库完成一次目录加载，避免挂载期重复请求。 */
  const loadedFor = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCategories((await listRetrievalCategories(knowledgeId)).items);
      loadedFor.current = knowledgeId;
    } catch {
      setError(t('knowledgeCategory.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [knowledgeId, t]);

  // 挂载即拉取一次：筛选摘要需要类别名称，否则只能回退显示类别 ID。
  useEffect(() => {
    if (!knowledgeId || loadedFor.current === knowledgeId) return;
    void load();
  }, [knowledgeId, load]);

  const selectedNames = selected.map(
    (id) => categories.find((item) => item.id === id)?.name ?? t('common.loading'),
  );
  const summary = selected.length ? selectedNames.join(' / ') : t('knowledgeCategory.auto');

  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        style={styles.button}
        onPress={() => {
          setVisible(true);
          if (!categories.length) void load();
        }}
      >
        <Text style={styles.summaryText} numberOfLines={2}>
          {t('knowledgeCategory.filter')}: {summary}
        </Text>
      </Pressable>
      <Modal transparent visible={visible} onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay} accessibilityViewIsModal>
          <ScrollView
            style={styles.sheet}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text accessibilityRole="header" style={styles.title}>
              {t('knowledgeCategory.filter')}
            </Text>
            <Text style={styles.hint}>{t('knowledgeCategory.limit')}</Text>
            {loading ? <Text style={styles.hint}>{t('documentActions.processing')}</Text> : null}
            <CategoryPicker
              categories={categories}
              selected={selected}
              onChange={onChange}
              multiple
              emptyLabel={t('knowledgeCategory.auto')}
              disabled={disabled || loading}
            />
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={() => void load()}
              style={styles.action}
            >
              <Text style={styles.actionText}>{t('knowledgeCategory.refresh')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisible(false)}
              style={styles.action}
            >
              <Text style={styles.actionText}>{t('common.close')}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  button: { justifyContent: 'center', minHeight: 48, padding: spacing.sm },
  summaryText: { ...typography.description, color: textColors.primary },
  title: { ...typography.heading3, color: textColors.primary },
  hint: { ...typography.description, color: textColors.secondary },
  error: { ...typography.description, color: colors.danger },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(16,24,40,0.28)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  sheet: {
    backgroundColor: colors.white,
    borderRadius: radii.default,
    maxHeight: '90%',
    maxWidth: 480,
    width: '100%',
  },
  content: { gap: spacing.sm, padding: spacing.md },
  action: { justifyContent: 'center', minHeight: 48, padding: spacing.sm },
  actionText: { ...typography.description, color: textColors.primary },
});
