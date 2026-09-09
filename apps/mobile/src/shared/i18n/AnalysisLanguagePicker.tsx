/**
 * 分析语言单选组件。
 *
 * 在所有新建或重跑分析表单中复用，不持久化也不修改 App 语言。
 *
 * Responsibilities:
 * - 选择中文或英文分析语言。
 * - 明示首期支持范围与不翻译语义。
 */
import type { SupportedLanguage } from '@echowave/contracts';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { useAppLanguage } from './LanguageProvider';

/** 渲染独立于 App 语言的分析语言选择器。 */
export function AnalysisLanguagePicker({
  value,
  onChange,
}: {
  value: SupportedLanguage;
  onChange: (language: SupportedLanguage) => void;
}) {
  const { t } = useAppLanguage();
  return (
    <View style={styles.container}>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {(['zh-CN', 'en'] as const).map((language) => {
          const selected = language === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={language}
              onPress={() => onChange(language)}
              style={[styles.option, selected && styles.selected]}
              testID={`analysis-language-${language}`}
            >
              <Text style={[styles.label, selected && styles.selectedLabel]}>
                {t(language === 'zh-CN' ? 'analysisLanguage.zhCN' : 'analysisLanguage.en')}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{t('analysisLanguage.supported')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  options: { flexDirection: 'row', gap: spacing.sm },
  option: {
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    padding: spacing.base,
  },
  selected: { backgroundColor: colors.ink, borderColor: colors.ink },
  label: { ...typography.body, color: textColors.primary, textAlign: 'center' },
  selectedLabel: { color: colors.white },
  hint: { ...typography.description, color: textColors.secondary },
});
