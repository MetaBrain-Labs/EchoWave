/**
 * 知识语义类别选择器。
 *
 * 在原生和 Web 使用同一可访问选项列表，支持继承与最多三个检索类别。
 *
 * Responsibilities:
 * - 只更新调用方编辑草稿，不保存业务数据。
 *
 * Notes:
 * - 停用项可展示但不能成为新分类覆盖。
 */
import type { KnowledgeCategory } from '@echowave/contracts';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, spacing, textColors, typography } from '@/shared/theme/tokens';

const categoryDescriptions: Record<string, string> = {
  terminology: '术语、热词、实体和纠错内容',
  product: '产品、服务、价格和规格资料',
  sop: '业务规则、标准流程和操作规范',
  compliance: '合规边界、风险和禁止事项',
  case: '业务案例、推荐话术和应对示例',
  test: '评估与纠错测试样例',
  general: '尚未归入专项类别的通用内容',
};

function categoryDescription(category: KnowledgeCategory) {
  return categoryDescriptions[category.key ?? ''] ?? '自定义知识类别';
}

/** 单类别分类和多类别查询共用的可访问选择器。 */
export function CategoryPicker({
  categories,
  selected,
  onChange,
  emptyLabel,
  multiple = false,
  disabled = false,
}: {
  categories: KnowledgeCategory[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyLabel?: string;
  multiple?: boolean;
  disabled?: boolean;
}) {
  const { t } = useAppLanguage();
  return (
    <View style={styles.options}>
      {emptyLabel ? (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: selected.length === 0, disabled }}
          disabled={disabled}
          onPress={() => onChange([])}
          style={[styles.option, selected.length === 0 && styles.selectedOption]}
        >
          <View style={styles.copy}>
            <Text style={styles.name}>{emptyLabel}</Text>
            <Text numberOfLines={1} style={styles.description}>
              {t('knowledgeCategory.auto')}
            </Text>
          </View>
          <Ionicons
            color={selected.length === 0 ? colors.primary : colors.muted}
            name={selected.length === 0 ? 'radio-button-on' : 'radio-button-off'}
            size={22}
          />
        </Pressable>
      ) : null}
      {categories.map((item) => {
        const checked = selected.includes(item.id);
        const unavailable =
          disabled || !item.active || (multiple && !checked && selected.length >= 3);
        return (
          <Pressable
            key={item.id}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityLabel={item.name}
            accessibilityState={{
              checked: multiple ? checked : undefined,
              selected: !multiple ? checked : undefined,
              disabled: unavailable,
            }}
            disabled={unavailable}
            style={[
              styles.option,
              checked && styles.selectedOption,
              unavailable && styles.disabled,
            ]}
            onPress={() =>
              onChange(
                multiple
                  ? checked
                    ? selected.filter((id) => id !== item.id)
                    : [...selected, item.id]
                  : [item.id],
              )
            }
          >
            <View style={styles.copy}>
              <Text style={styles.name}>
                {item.name}
                {!item.active ? ` · ${t('knowledgeCategory.disabled')}` : ''}
              </Text>
              <Text numberOfLines={1} style={styles.description}>
                {item.key === 'test' ? t('knowledgeCategory.testHint') : categoryDescription(item)}
              </Text>
            </View>
            <Ionicons
              color={checked ? colors.primary : colors.muted}
              name={checked ? 'radio-button-on' : 'radio-button-off'}
              size={22}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  options: { gap: spacing.sm },
  option: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectedOption: {
    backgroundColor: colors.primarySurface,
    borderColor: colors.primaryBorder,
  },
  copy: { flex: 1, gap: 2 },
  name: { ...typography.body, color: textColors.primary, fontWeight: '600' },
  description: { ...typography.description, color: textColors.secondary },
  disabled: { opacity: 0.55 },
});
