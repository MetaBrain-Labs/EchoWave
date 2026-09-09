/**
 * 通用设置页面。
 *
 * 承载语言等应用级偏好设置，避免“更多”导航页同时承担设置编辑职责。
 *
 * Responsibilities:
 * - 展示并切换当前应用语言。
 * - 在持久化失败时保留原语言并向用户反馈错误。
 *
 * Notes:
 * - 语言状态与 AsyncStorage 持久化由 LanguageProvider 负责。
 */
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';

/** 渲染应用级设置，并保留语言保存失败时的当前选择。 */
export function GeneralSettingsScreen({ onBack }: { onBack: () => void }) {
  const { language, setLanguage, t } = useAppLanguage();

  const changeLanguage = async (next: 'zh-CN' | 'en') => {
    try {
      await setLanguage(next);
    } catch {
      Alert.alert(t('common.saveFailed'), t('language.saveError'));
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <TopLevelPageHeader
        onBack={onBack}
        subtitle={t('generalSettings.subtitle')}
        title={t('generalSettings.title')}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('language.section')}
          </Text>
          <View accessibilityRole="radiogroup" style={styles.options}>
            {(['zh-CN', 'en'] as const).map((option) => (
              <Pressable
                accessibilityLabel={t(option === 'zh-CN' ? 'language.zhCN' : 'language.en')}
                accessibilityRole="radio"
                accessibilityState={{ checked: language === option }}
                key={option}
                onPress={() => void changeLanguage(option)}
                style={[styles.option, language === option && styles.selected]}
              >
                <Text style={[styles.label, language === option && styles.selectedLabel]}>
                  {t(option === 'zh-CN' ? 'language.zhCN' : 'language.en')}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.description}>{t('language.supported')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  title: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  options: { flexDirection: 'row', gap: spacing.sm },
  option: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    padding: spacing.base,
  },
  selected: { backgroundColor: colors.ink, borderColor: colors.ink },
  label: { ...typography.body, color: textColors.primary, textAlign: 'center' },
  selectedLabel: { color: colors.white },
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
});
