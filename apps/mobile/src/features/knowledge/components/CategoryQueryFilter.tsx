/**
 * 问答类别筛选面板。
 *
 * 支持单库与跨库两种检索范围：跨库时按知识库分组展示可检索类别，
 * 并可逐个取消某个知识库；进入时默认勾选全部参与知识库的启用类别。
 *
 * Responsibilities:
 * - 读取参与检索知识库的类别目录，并按知识库分组展示。
 * - 维护“按库取消”的检索范围开关，不保存任何业务数据。
 *
 * Notes:
 * - 单个知识库目录失败时给出提示与刷新入口，其余知识库仍可筛选。
 */
import type { KnowledgeCategory } from '@echowave/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { listRetrievalCategoriesByBase } from '../apiClient';
import { CategoryPicker } from './CategoryPicker';

/** 类别目录项：跨库时带所属知识库，用于分组展示。 */
export type RetrievalCategory = KnowledgeCategory & { knowledgeBaseId: string };

const EMPTY_CATEGORIES: RetrievalCategory[] = [];

/** 自动路由与显式多选筛选共存；跨库时按知识库分组并支持按库取消。 */
export function CategoryQueryFilter({
  knowledgeId,
  knowledgeBases,
  excludedKnowledgeBaseIds = EMPTY_EXCLUDED,
  onToggleKnowledgeBase,
  selected,
  onChange,
  disabled,
}: {
  knowledgeId: string;
  /** 参与检索的知识库集合；缺省或只有一个时按单库展示。 */
  knowledgeBases?: { id: string; name: string }[];
  /** 被用户取消参与检索的知识库。 */
  excludedKnowledgeBaseIds?: string[];
  onToggleKnowledgeBase?: (id: string) => void;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useAppLanguage();
  const [visible, setVisible] = useState(false);
  const [categories, setCategories] = useState<RetrievalCategory[]>(EMPTY_CATEGORIES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** 已完成的加载范围，避免挂载期与打开面板时重复请求。 */
  const loadedFor = useRef<string | undefined>(undefined);

  const bases = knowledgeBases?.length ? knowledgeBases : [{ id: knowledgeId, name: '' }];
  const baseKey = bases.map((base) => base.id).join(',');
  const crossBase = bases.length > 1;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listRetrievalCategoriesByBase(bases);
      setCategories(result.categories);
      if (result.failed) setError(t('knowledgeCategory.loadFailed'));
      loadedFor.current = baseKey;
    } catch {
      setError(t('knowledgeCategory.loadFailed'));
    } finally {
      setLoading(false);
    }
    // bases 由 baseKey 完整决定，避免每次渲染重建数组导致重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, t]);

  // 挂载即拉取一次：筛选摘要需要类别名称，否则只能回退显示类别 ID。
  useEffect(() => {
    if (!knowledgeId || loadedFor.current === baseKey) return;
    void load();
  }, [baseKey, knowledgeId, load]);

  const selectedNames = selected.map(
    (id) => categories.find((item) => item.id === id)?.name ?? t('common.loading'),
  );
  const summary = selected.length ? selectedNames.join(' / ') : t('knowledgeCategory.auto');

  /** 按知识库分组渲染类别，跨库时显示归属标题。 */
  const groups = bases.map((base) => ({
    base,
    items: categories.filter((category) => category.knowledgeBaseId === base.id),
    included: !excludedKnowledgeBaseIds.includes(base.id),
  }));

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
        <Text numberOfLines={2} style={styles.summaryText}>
          {t('knowledgeCategory.filter')}: {summary}
        </Text>
        {crossBase ? (
          <Text style={styles.summaryMeta}>
            {t('knowledgeCategory.scope', {
              count: bases.length - excludedKnowledgeBaseIds.length,
            })}
          </Text>
        ) : null}
      </Pressable>
      <Modal transparent visible={visible} onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay} accessibilityViewIsModal>
          {/* 由 View 承担最大高度约束，ScrollView 随内容收缩、超出才滚动。 */}
          <View style={styles.sheet}>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              style={styles.sheetScroll}
            >
              <Text accessibilityRole="header" style={styles.title}>
                {t('knowledgeCategory.filter')}
              </Text>
              <Text style={styles.hint}>
                {crossBase ? t('knowledgeCategory.multiBaseHint') : t('knowledgeCategory.limit')}
              </Text>
              {crossBase ? (
                <View style={styles.baseRow}>
                  {groups.map((group) => (
                    <Pressable
                      key={group.base.id}
                      accessibilityLabel={group.base.name || group.base.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: group.included }}
                      disabled={disabled || loading}
                      onPress={() => onToggleKnowledgeBase?.(group.base.id)}
                      style={[styles.baseChip, group.included && styles.baseChipActive]}
                    >
                      <Text
                        style={[styles.baseChipText, group.included && styles.baseChipTextActive]}
                      >
                        {group.base.name || group.base.id}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {loading ? <Text style={styles.hint}>{t('documentActions.processing')}</Text> : null}
              {groups.map((group) => (
                <View key={group.base.id} style={styles.group}>
                  {crossBase ? (
                    <Text style={styles.groupTitle}>
                      {group.base.name || group.base.id}
                      {group.included ? '' : ` · ${t('knowledgeCategory.excluded')}`}
                    </Text>
                  ) : null}
                  {group.included ? (
                    <CategoryPicker
                      categories={group.items}
                      selected={selected}
                      onChange={onChange}
                      multiple
                      // 跨库时不提供“自动选择类别”：取消全部类别只会缩小范围，不会扩大检索。
                      emptyLabel={crossBase ? undefined : t('knowledgeCategory.auto')}
                      disabled={disabled || loading}
                    />
                  ) : (
                    <Text style={styles.hint}>{t('knowledgeCategory.excludedHint')}</Text>
                  )}
                </View>
              ))}
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={loading}
                onPress={() => void load()}
                style={({ pressed }) => [
                  styles.primaryAction,
                  loading && styles.disabledAction,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.primaryActionText}>{t('knowledgeCategory.refresh')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setVisible(false)}
                style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryActionText}>{t('common.close')}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const EMPTY_EXCLUDED: string[] = [];

const styles = StyleSheet.create({
  button: { gap: 2, justifyContent: 'center', minHeight: 48, padding: spacing.sm },
  summaryText: { ...typography.description, color: textColors.primary },
  summaryMeta: { ...typography.label, color: textColors.secondary },
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
  // 内容多高占多高，超过上限才滚动：sheet 只做最大高度约束，滚动交给内部 ScrollView。
  sheet: {
    backgroundColor: colors.white,
    borderRadius: radii.default,
    flexShrink: 1,
    maxHeight: '85%',
    maxWidth: 480,
    width: '100%',
  },
  sheetScroll: { flexShrink: 1 },
  content: { gap: spacing.sm, padding: spacing.md },
  baseRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  baseChip: {
    borderColor: colors.divider,
    borderRadius: radii.round,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  baseChipActive: { backgroundColor: colors.primarySurface, borderColor: colors.primaryBorder },
  baseChipText: { ...typography.description, color: textColors.secondary },
  baseChipTextActive: {
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  group: { gap: spacing.xs },
  groupTitle: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  // 主操作沿用项目统一的深色胶囊按钮，次操作使用描边按钮，避免裸文字按钮。
  primaryAction: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  primaryActionText: {
    ...typography.description,
    color: colors.card,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  secondaryAction: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  secondaryActionText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  disabledAction: { opacity: 0.5 },
  pressed: { opacity: 0.72 },
});
