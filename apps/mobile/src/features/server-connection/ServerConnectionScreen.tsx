/**
 * EchoWave Server 连接页面。
 *
 * 让首次启动和后续服务器切换共享地址校验、健康探测与持久化交互。
 *
 * Responsibilities:
 * - 编辑并验证运行时服务器根地址。
 * - 仅在兼容性探测成功后允许保存。
 * - 对局域网 HTTP 显示明确的安全边界提示。
 *
 * Notes:
 * - V1 不包含二维码和局域网自动发现。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchServerHealth, ServerHealthError } from '@/shared/api/serverHealth';
import { useServerConnection } from '@/shared/api/ServerConnectionProvider';
import {
  getDevelopmentServerUrl,
  normalizeServerUrl,
  ServerUrlError,
  type ServerUrlErrorCode,
} from '@/shared/api/serverUrl';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import type { TranslationKey } from '@/shared/i18n/translations';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

type ProbeState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'success'; normalizedUrl: string; version: string }
  | { phase: 'error'; message: string };

type ServerConnectionScreenProps = {
  onCancel?: () => void;
  onSaved?: () => void;
};

const serverUrlErrorKeys: Record<ServerUrlErrorCode, TranslationKey> = {
  EMPTY: 'server.empty',
  INVALID_URL: 'server.fullUrl',
  INVALID_PROTOCOL: 'server.protocol',
  CREDENTIALS_NOT_ALLOWED: 'server.credentials',
  PATH_NOT_ALLOWED: 'server.rootOnly',
  PUBLIC_HTTP_NOT_ALLOWED: 'server.publicHttps',
  UNCONFIGURED: 'server.invalid',
};

const serverHealthErrorKeys: Record<ServerHealthError['code'], TranslationKey> = {
  HTTP_ERROR: 'server.verifyFailed',
  INVALID_RESPONSE: 'server.incompatible',
  NETWORK: 'server.network',
  TIMEOUT: 'server.timeout',
};

/** 渲染首次连接或修改服务器地址的完整表单。 */
export function ServerConnectionScreen({ onCancel, onSaved }: ServerConnectionScreenProps) {
  const { t } = useAppLanguage();
  const { saveServerUrl, serverUrl } = useServerConnection();
  const [input, setInput] = useState(serverUrl ?? getDevelopmentServerUrl() ?? '');
  const [probe, setProbe] = useState<ProbeState>({ phase: 'idle' });
  const [saving, setSaving] = useState(false);
  const normalizedInput = useMemo(() => {
    try {
      return normalizeServerUrl(input);
    } catch {
      return null;
    }
  }, [input]);
  const usesLocalHttp = normalizedInput?.startsWith('http://') ?? false;
  const canSave = probe.phase === 'success' && probe.normalizedUrl === normalizedInput && !saving;

  const testConnection = async () => {
    let normalized: string;
    try {
      normalized = normalizeServerUrl(input);
    } catch (error) {
      setProbe({
        phase: 'error',
        message:
          error instanceof ServerUrlError ? t(serverUrlErrorKeys[error.code]) : t('server.invalid'),
      });
      return;
    }
    setProbe({ phase: 'loading' });
    try {
      const health = await fetchServerHealth(normalized);
      setInput(normalized);
      setProbe({ phase: 'success', normalizedUrl: normalized, version: health.version });
    } catch (error) {
      setProbe({
        phase: 'error',
        message:
          error instanceof ServerHealthError
            ? t(serverHealthErrorKeys[error.code])
            : t('server.verifyFailed'),
      });
    }
  };

  const save = async () => {
    if (!canSave || probe.phase !== 'success') return;
    setSaving(true);
    try {
      await saveServerUrl(probe.normalizedUrl);
      onSaved?.();
    } catch {
      setProbe({ phase: 'error', message: t('server.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea} testID="echowave-ready">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          testID="server-connection-screen"
        >
          <View style={styles.logo}>
            <Ionicons color={colors.white} name="radio-outline" size={30} />
          </View>
          <Text style={styles.title}>{t('server.title')}</Text>
          <Text style={styles.tagline}>EchoWave — From Voice to Insight.</Text>
          <Text style={styles.description}>{t('server.description')}</Text>

          <View style={styles.card}>
            <Text style={styles.label}>{t('server.address')}</Text>
            <TextInput
              accessibilityLabel={t('server.address')}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={(value) => {
                setInput(value);
                setProbe({ phase: 'idle' });
              }}
              placeholder="http://192.168.1.7:3001"
              placeholderTextColor={textColors.tertiary}
              style={styles.input}
              testID="服务器地址"
              value={input}
            />
            {usesLocalHttp ? (
              <View accessibilityRole="alert" style={styles.warning}>
                <Ionicons color={colors.danger} name="warning-outline" size={18} />
                <Text style={styles.warningText}>{t('server.httpWarning')}</Text>
              </View>
            ) : null}
            {probe.phase === 'success' ? (
              <View
                accessibilityRole="alert"
                style={styles.success}
                testID="server-connection-success"
              >
                <Ionicons color={colors.success} name="checkmark-circle" size={18} />
                <Text style={styles.successText}>
                  {t('server.connected', { version: probe.version })}
                </Text>
              </View>
            ) : null}
            {probe.phase === 'error' ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {probe.message}
              </Text>
            ) : null}

            <Pressable
              accessibilityLabel={t('server.test')}
              accessibilityRole="button"
              disabled={probe.phase === 'loading' || saving}
              onPress={() => void testConnection()}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              testID="测试连接"
            >
              {probe.phase === 'loading' ? (
                <ActivityIndicator color={colors.ink} />
              ) : (
                <Ionicons color={colors.ink} name="pulse-outline" size={20} />
              )}
              <Text style={styles.secondaryButtonText}>{t('server.test')}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={t('server.saveContinue')}
              accessibilityRole="button"
              disabled={!canSave}
              onPress={() => void save()}
              style={({ pressed }) => [
                styles.primaryButton,
                !canSave && styles.disabled,
                pressed && canSave && styles.pressed,
              ]}
              testID="保存并继续"
            >
              {saving ? <ActivityIndicator color={colors.white} /> : null}
              <Text style={styles.primaryButtonText}>{t('server.saveContinue')}</Text>
            </Pressable>
            {onCancel ? (
              <Pressable
                accessibilityLabel={t('server.cancelChange')}
                accessibilityRole="button"
                onPress={onCancel}
                style={styles.cancelButton}
                testID="取消修改服务器"
              >
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  logo: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.round,
    height: 60,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 60,
  },
  title: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  tagline: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    letterSpacing: 0.3,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  description: {
    ...typography.description,
    color: textColors.secondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xl,
    padding: spacing.md,
  },
  label: { ...typography.label, color: textColors.secondary, marginBottom: spacing.xs },
  input: {
    ...typography.body,
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    color: textColors.primary,
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  warning: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  warningText: { ...typography.label, color: textColors.secondary, flex: 1 },
  success: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  successText: { ...typography.label, color: colors.success, flex: 1 },
  errorText: { ...typography.label, color: colors.danger, marginTop: spacing.sm },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 50,
  },
  secondaryButtonText: { ...typography.body, color: textColors.primary, fontWeight: 'bold' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 50,
  },
  primaryButtonText: { ...typography.body, color: colors.white, fontWeight: 'bold' },
  cancelButton: { alignItems: 'center', marginTop: spacing.md, padding: spacing.sm },
  cancelText: { ...typography.body, color: textColors.secondary },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.65 },
});
