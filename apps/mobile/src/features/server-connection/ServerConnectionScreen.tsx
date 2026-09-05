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

import { fetchServerHealth } from '@/shared/api/serverHealth';
import { useServerConnection } from '@/shared/api/ServerConnectionProvider';
import {
  getDevelopmentServerUrl,
  normalizeServerUrl,
  ServerUrlError,
} from '@/shared/api/serverUrl';
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

/** 渲染首次连接或修改服务器地址的完整表单。 */
export function ServerConnectionScreen({ onCancel, onSaved }: ServerConnectionScreenProps) {
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
        message: error instanceof ServerUrlError ? error.message : '服务器地址无效。',
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
        message: error instanceof Error ? error.message : '无法验证服务器。',
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
      setProbe({ phase: 'error', message: '无法保存服务器设置，请检查设备存储后重试。' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
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
          <Text style={styles.title}>连接到 EchoWave Server</Text>
          <Text style={styles.tagline}>EchoWave — From Voice to Insight.</Text>
          <Text style={styles.description}>
            输入运行 EchoWave API 的电脑、NAS 或服务器地址。连接成功后会保存在当前设备。
          </Text>

          <View style={styles.card}>
            <Text style={styles.label}>服务器地址</Text>
            <TextInput
              accessibilityLabel="服务器地址"
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
              value={input}
            />
            {usesLocalHttp ? (
              <View accessibilityRole="alert" style={styles.warning}>
                <Ionicons color={colors.danger} name="warning-outline" size={18} />
                <Text style={styles.warningText}>
                  HTTP 仅适合可信局域网；公网服务器必须使用 HTTPS。
                </Text>
              </View>
            ) : null}
            {probe.phase === 'success' ? (
              <View accessibilityRole="alert" style={styles.success}>
                <Ionicons color={colors.success} name="checkmark-circle" size={18} />
                <Text style={styles.successText}>连接成功 · EchoWave {probe.version}</Text>
              </View>
            ) : null}
            {probe.phase === 'error' ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {probe.message}
              </Text>
            ) : null}

            <Pressable
              accessibilityLabel="测试连接"
              accessibilityRole="button"
              disabled={probe.phase === 'loading' || saving}
              onPress={() => void testConnection()}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              {probe.phase === 'loading' ? (
                <ActivityIndicator color={colors.ink} />
              ) : (
                <Ionicons color={colors.ink} name="pulse-outline" size={20} />
              )}
              <Text style={styles.secondaryButtonText}>测试连接</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="保存并继续"
              accessibilityRole="button"
              disabled={!canSave}
              onPress={() => void save()}
              style={({ pressed }) => [
                styles.primaryButton,
                !canSave && styles.disabled,
                pressed && canSave && styles.pressed,
              ]}
            >
              {saving ? <ActivityIndicator color={colors.white} /> : null}
              <Text style={styles.primaryButtonText}>保存并继续</Text>
            </Pressable>
            {onCancel ? (
              <Pressable
                accessibilityLabel="取消修改服务器"
                accessibilityRole="button"
                onPress={onCancel}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelText}>取消</Text>
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
