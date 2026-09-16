/**
 * 通用设置页面。
 *
 * 承载语言等应用级偏好设置，避免“更多”导航页同时承担设置编辑职责。
 *
 * Responsibilities:
 * - 展示并切换当前应用语言。
 * - 读取并保存租户共享的 ASR 默认上下文。
 * - 在持久化失败时保留原语言并向用户反馈错误。
 *
 * Notes:
 * - 语言状态与 AsyncStorage 持久化由 LanguageProvider 负责。
 */
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useAnalysisPreference,
  type AnalysisPreference,
} from '@/shared/settings/AnalysisPreferenceProvider';
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
import { getAsrPreferences, updateAsrPreferences } from '@/shared/api/asrPreferencesApi';

/** 渲染应用级设置，并保留语言与 ASR 默认上下文保存失败时的当前选择。 */
export function GeneralSettingsScreen({ onBack }: { onBack: () => void }) {
  const { language, setLanguage, t } = useAppLanguage();
  const { preference, hydrated, setPreference } = useAnalysisPreference();
  const [asrContext, setAsrContext] = useState('');
  const [asrRevision, setAsrRevision] = useState(0);
  const [asrLoading, setAsrLoading] = useState(true);
  const [asrSaving, setAsrSaving] = useState(false);
  const [adminToken, setAdminToken] = useState('');

  useEffect(() => {
    let active = true;
    void getAsrPreferences()
      .then((value) => {
        if (!active) return;
        setAsrContext(value.defaultContext);
        setAsrRevision(value.revision);
        setAsrLoading(false);
      })
      .catch(() => {
        if (active) {
          setAsrLoading(false);
          Alert.alert(t('generalSettings.asrLoadFailed'));
        }
      });
    return () => {
      active = false;
    };
  }, [t]);

  const saveAsrContext = async () => {
    if (asrLoading || asrSaving || !adminToken.trim()) return;
    setAsrSaving(true);
    try {
      const saved = await updateAsrPreferences(
        { defaultContext: asrContext, expectedRevision: asrRevision },
        adminToken.trim(),
      );
      setAsrRevision(saved.revision);
      setAdminToken('');
      Alert.alert(t('generalSettings.asrSaved'));
    } catch {
      Alert.alert(t('generalSettings.asrSaveFailed'));
    } finally {
      setAsrSaving(false);
    }
  };

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
            {t('recording.preference')}
          </Text>
          <View accessibilityRole="radiogroup" style={styles.options}>
            {(['full', 'transcription_only'] as AnalysisPreference[]).map((option) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: preference === option, disabled: !hydrated }}
                disabled={!hydrated}
                onPress={() =>
                  void setPreference(option).catch(() =>
                    Alert.alert(t('common.saveFailed'), t('recording.preferenceSaveFailed')),
                  )
                }
                style={[styles.option, preference === option && styles.selected]}
              >
                <Text style={[styles.label, preference === option && styles.selectedLabel]}>
                  {t(option === 'full' ? 'recording.full' : 'recording.transcriptionOnly')}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.description}>{t('recording.preferenceDescription')}</Text>
        </View>
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
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('generalSettings.asrTitle')}
          </Text>
          <Text style={styles.description}>{t('generalSettings.asrDescription')}</Text>
          {asrLoading ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} color={colors.ink} />
          ) : null}
          <Text style={styles.fieldLabel}>{t('generalSettings.asrContextLabel')}</Text>
          <TextInput
            accessibilityLabel={t('generalSettings.asrContextLabel')}
            editable={!asrLoading && !asrSaving}
            maxLength={400}
            multiline
            onChangeText={setAsrContext}
            placeholder={t('generalSettings.asrContextPlaceholder')}
            placeholderTextColor={textColors.tertiary}
            style={styles.contextInput}
            textAlignVertical="top"
            value={asrContext}
          />
          <Text style={styles.fieldLabel}>{t('generalSettings.asrAdminTokenLabel')}</Text>
          <TextInput
            accessibilityLabel={t('generalSettings.asrAdminTokenLabel')}
            editable={!asrSaving}
            onChangeText={setAdminToken}
            placeholder={t('generalSettings.asrAdminTokenPlaceholder')}
            placeholderTextColor={textColors.tertiary}
            secureTextEntry
            style={styles.tokenInput}
            textAlignVertical="center"
            value={adminToken}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: asrLoading || asrSaving || !adminToken.trim() }}
            disabled={asrLoading || asrSaving || !adminToken.trim()}
            onPress={() => void saveAsrContext()}
            style={({ pressed }) => [
              styles.saveButton,
              (asrLoading || asrSaving || !adminToken.trim()) && styles.disabledButton,
              pressed && styles.pressed,
            ]}
          >
            {asrSaving ? <ActivityIndicator color={colors.white} /> : null}
            <Text style={styles.saveButtonText}>{t('generalSettings.asrSave')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
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
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  selected: { backgroundColor: colors.ink, borderColor: colors.ink },
  label: { ...typography.body, color: textColors.primary, textAlign: 'center' },
  selectedLabel: { color: colors.white },
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  fieldLabel: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  contextInput: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    minHeight: 96,
    padding: spacing.sm,
  },
  tokenInput: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    height: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 44,
    justifyContent: 'center',
  },
  saveButtonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  disabledButton: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
});
