/**
 * 知识库类别管理页面。
 *
 * 只负责浏览租户类别目录和进入单个类别编辑，不在默认类别选择页面内展开管理表单。
 *
 * Responsibilities:
 * - 以稳定顺序展示预置类别和自定义类别。
 * - 提供新增类别入口与类别编辑导航。
 *
 * Notes:
 * - 类别停用、版本冲突和历史归属由服务端 API 决定。
 */
import type { KnowledgeCategory } from '@echowave/contracts';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listKnowledgeCategories } from '../apiClient';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, spacing, textColors, typography } from '@/shared/theme/tokens';

const categoryOrder = ['case', 'compliance', 'general', 'product', 'sop', 'terminology', 'test'];
const categoryDescriptions: Record<string, string> = {
  case: '业务案例、推荐话术和应对示例',
  compliance: '合规边界、风险和禁止事项',
  general: '尚未归入专项类别的通用内容',
  product: '产品、服务、价格和规格资料',
  sop: '业务规则、标准流程和操作规范',
  terminology: '术语、热词、实体和纠错内容',
  test: '仅用于评估和测试，不参与普通检索。',
};

function orderCategories(categories: KnowledgeCategory[]) {
  return [...categories].sort((left, right) => {
    const leftIndex = left.key ? categoryOrder.indexOf(left.key) : categoryOrder.length;
    const rightIndex = right.key ? categoryOrder.indexOf(right.key) : categoryOrder.length;
    return leftIndex - rightIndex || left.name.localeCompare(right.name, 'zh-CN');
  });
}

function displayDescription(category: KnowledgeCategory) {
  return categoryDescriptions[category.key ?? ''] ?? category.description;
}

type CategoryManagementScreenProps = {
  onBack: () => void;
  onOpenCategory: (categoryId: string) => void;
  onAddCategory: () => void;
};

/** 渲染独立的类别目录页面。 */
export function CategoryManagementScreen({
  onAddCategory,
  onBack,
  onOpenCategory,
}: CategoryManagementScreenProps) {
  const { t } = useAppLanguage();
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(orderCategories((await listKnowledgeCategories()).items));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('knowledgeCategory.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={t('common.back')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          style={styles.headerButton}
        >
          <Ionicons color={textColors.primary} name="chevron-back" size={28} />
        </Pressable>
        <Text style={styles.title}>{t('knowledgeCategory.managementTitle')}</Text>
        <Pressable
          accessibilityLabel={t('knowledgeCategory.add')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onAddCategory}
          style={styles.headerButton}
        >
          <Ionicons color={colors.primary} name="add" size={28} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {error ? (
          <View style={styles.feedback}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void load()}>
              <Text style={styles.retry}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        ) : null}
        {!loading && !error && categories.length === 0 ? (
          <Text style={styles.muted}>{t('knowledgeCategory.noCategories')}</Text>
        ) : null}
        {categories.map((category) => (
          <Pressable
            accessibilityRole="button"
            key={category.id}
            onPress={() => onOpenCategory(category.id)}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.pressed,
              !category.active && styles.inactive,
            ]}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{category.name}</Text>
              <Text numberOfLines={1} style={styles.muted}>
                {category.key === 'test'
                  ? t('knowledgeCategory.testHint')
                  : displayDescription(category)}
              </Text>
            </View>
            {!category.active ? (
              <Text style={styles.status}>{t('knowledgeCategory.disabled')}</Text>
            ) : null}
            <Ionicons color={textColors.secondary} name="chevron-forward" size={20} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 60,
    paddingHorizontal: spacing.sm,
  },
  headerButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  title: {
    ...typography.heading1,
    color: textColors.primary,
    flex: 1,
    fontWeight: '700',
    textAlign: 'center',
  },
  content: { gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.xl },
  row: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    flexDirection: 'row',
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { ...typography.body, color: textColors.primary, fontWeight: '700' },
  muted: { ...typography.description, color: textColors.secondary },
  status: { ...typography.label, color: colors.danger, marginRight: spacing.sm },
  inactive: { opacity: 0.66 },
  pressed: { opacity: 0.72 },
  feedback: { gap: spacing.sm, paddingVertical: spacing.sm },
  error: { ...typography.description, color: colors.danger },
  retry: { ...typography.body, color: colors.primary, fontWeight: '700' },
});
