/**
 * 服务配置页面。
 *
 * 集中承载管理员维护的租户级服务器配置：管理员校验、ASR 默认上下文与相关配置入口。
 *
 * Responsibilities:
 * - 让管理员口令在“更多”下的配置页之间共用一次校验。
 * - 读取并保存租户共享的 ASR 默认上下文，失败时保留原值并反馈原因。
 * - 提供 AI 配置与运行模式的显式入口。
 *
 * Notes:
 * - 本页只编排共享客户端；服务端仍是配置与授权的唯一权威。
 * - 设备级偏好（语言、默认分析方式）留在通用设置，不在此重复。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAsrPreferences, updateAsrPreferences } from '@/shared/api/asrPreferencesApi';
import { settingsApi } from '@/shared/api/settingsApi';
import { WorkspaceRequestError } from '@/shared/api/request';
import { useAdminSession } from '@/shared/auth/AdminSessionProvider';
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
import { multilineTextInputText, textInputText } from '@/shared/theme/textInput';

/** 渲染管理员校验、ASR 默认上下文和服务器配置入口。 */
export function ServiceConfigurationScreen({
  onBack,
  onOpenAi,
  onOpenRuntime,
}: {
  onBack: () => void;
  onOpenAi: () => void;
  onOpenRuntime: () => void;
}) {
  const { t } = useAppLanguage();
  const { token, setSession, clearSession } = useAdminSession();
  const [tokenInput, setTokenInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [asrContext, setAsrContext] = useState('');
  const [asrRevision, setAsrRevision] = useState(0);
  const [asrLoading, setAsrLoading] = useState(true);
  const [asrSaving, setAsrSaving] = useState(false);

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
        if (!active) return;
        setAsrLoading(false);
        Alert.alert(t('serviceConfig.asrLoadFailed'));
      });
    return () => {
      active = false;
    };
  }, [t]);

  const verifyToken = async () => {
    const candidate = tokenInput.trim();
    if (!candidate || verifying) return;
    setVerifying(true);
    try {
      await settingsApi.verify(candidate);
      setSession(candidate);
      setTokenInput('');
    } catch {
      Alert.alert(t('serviceConfig.sessionInvalid'));
    } finally {
      setVerifying(false);
    }
  };

  const saveAsrContext = async () => {
    if (!token || asrLoading || asrSaving) return;
    setAsrSaving(true);
    try {
      const saved = await updateAsrPreferences(
        { defaultContext: asrContext, expectedRevision: asrRevision },
        token,
      );
      setAsrRevision(saved.revision);
      Alert.alert(t('serviceConfig.asrSaved'));
    } catch (reason) {
      // 会话已失效时立即回到未验证状态，避免用户重复提交同一个无效口令。
      if (reason instanceof WorkspaceRequestError && reason.code === 'UNAUTHORIZED') clearSession();
      Alert.alert(t('serviceConfig.asrSaveFailed'));
    } finally {
      setAsrSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <TopLevelPageHeader
        onBack={onBack}
        subtitle={t('serviceConfig.subtitle')}
        title={t('serviceConfig.title')}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('serviceConfig.sessionTitle')}
          </Text>
          <Text style={styles.description}>
            {token ? t('serviceConfig.sessionActive') : t('serviceConfig.sessionDescription')}
          </Text>
          {token ? (
            <Pressable
              accessibilityLabel={t('serviceConfig.sessionClear')}
              accessibilityRole="button"
              onPress={clearSession}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Ionicons color={textColors.secondary} name="log-out-outline" size={20} />
              <Text style={styles.secondaryButtonText}>{t('serviceConfig.sessionClear')}</Text>
            </Pressable>
          ) : (
            <>
              <Text style={styles.fieldLabel}>{t('serviceConfig.sessionTokenLabel')}</Text>
              <TextInput
                accessibilityLabel={t('serviceConfig.sessionTokenLabel')}
                autoCapitalize="none"
                editable={!verifying}
                onChangeText={setTokenInput}
                placeholder={t('serviceConfig.sessionTokenPlaceholder')}
                placeholderTextColor={textColors.tertiary}
                secureTextEntry
                style={styles.tokenInput}
                value={tokenInput}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: verifying || !tokenInput.trim() }}
                disabled={verifying || !tokenInput.trim()}
                onPress={() => void verifyToken()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (verifying || !tokenInput.trim()) && styles.disabledButton,
                  pressed && styles.pressed,
                ]}
              >
                {verifying ? <ActivityIndicator color={colors.white} /> : null}
                <Text style={styles.primaryButtonText}>
                  {verifying
                    ? t('serviceConfig.sessionVerifying')
                    : t('serviceConfig.sessionVerify')}
                </Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('serviceConfig.asrTitle')}
          </Text>
          <Text style={styles.description}>{t('serviceConfig.asrDescription')}</Text>
          {asrLoading ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} color={colors.ink} />
          ) : null}
          <Text style={styles.fieldLabel}>{t('serviceConfig.asrContextLabel')}</Text>
          <TextInput
            accessibilityLabel={t('serviceConfig.asrContextLabel')}
            editable={!asrLoading && !asrSaving}
            maxLength={400}
            multiline
            onChangeText={setAsrContext}
            placeholder={t('serviceConfig.asrContextPlaceholder')}
            placeholderTextColor={textColors.tertiary}
            style={styles.contextInput}
            textAlignVertical="top"
            value={asrContext}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: asrLoading || asrSaving || !token }}
            disabled={asrLoading || asrSaving || !token}
            onPress={() => void saveAsrContext()}
            style={({ pressed }) => [
              styles.primaryButton,
              (asrLoading || asrSaving || !token) && styles.disabledButton,
              pressed && styles.pressed,
            ]}
          >
            {asrSaving ? <ActivityIndicator color={colors.white} /> : null}
            <Text style={styles.primaryButtonText}>{t('serviceConfig.asrSave')}</Text>
          </Pressable>
          {token ? null : <Text style={styles.help}>{t('serviceConfig.sessionDescription')}</Text>}
        </View>

        <Pressable
          accessibilityLabel={t('serviceConfig.aiTitle')}
          accessibilityRole="button"
          onPress={onOpenAi}
          style={({ pressed }) => [styles.navigationCard, pressed && styles.pressed]}
        >
          <View style={styles.navigationIcon}>
            <Ionicons color={colors.ink} name="build-outline" size={22} />
          </View>
          <View style={styles.navigationCopy}>
            <Text style={styles.navigationTitle}>{t('serviceConfig.aiTitle')}</Text>
            <Text style={styles.navigationDescription}>{t('serviceConfig.aiDescription')}</Text>
          </View>
          <Ionicons color={textColors.tertiary} name="chevron-forward" size={22} />
        </Pressable>

        <Pressable
          accessibilityLabel={t('serviceConfig.runtimeTitle')}
          accessibilityRole="button"
          onPress={onOpenRuntime}
          style={({ pressed }) => [styles.navigationCard, pressed && styles.pressed]}
        >
          <View style={styles.navigationIcon}>
            <Ionicons color={colors.ink} name="layers-outline" size={22} />
          </View>
          <View style={styles.navigationCopy}>
            <Text style={styles.navigationTitle}>{t('serviceConfig.runtimeTitle')}</Text>
            <Text style={styles.navigationDescription}>
              {t('serviceConfig.runtimeDescription')}
            </Text>
          </View>
          <Ionicons color={textColors.tertiary} name="chevron-forward" size={22} />
        </Pressable>
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
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  help: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  fieldLabel: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  contextInput: {
    ...multilineTextInputText,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    minHeight: 96,
    padding: spacing.sm,
    textAlignVertical: 'top',
  },
  tokenInput: {
    ...textInputText,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    height: 44,
    paddingHorizontal: spacing.sm,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 44,
    justifyContent: 'center',
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 44,
    justifyContent: 'center',
  },
  secondaryButtonText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  navigationCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.base,
    padding: spacing.md,
  },
  navigationIcon: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.round,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  navigationCopy: { flex: 1 },
  navigationTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginBottom: spacing.xs,
  },
  navigationDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  disabledButton: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
});
