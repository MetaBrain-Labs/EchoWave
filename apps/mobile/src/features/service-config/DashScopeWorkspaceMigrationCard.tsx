/**
 * 百炼业务空间域名迁移卡片。
 *
 * 在“更多”页提示仍使用旧 DashScope URL 的租户，并提供一次性批量迁移面板。
 *
 * Responsibilities:
 * - 读取不含敏感信息的迁移状态。
 * - 按共享契约校验 API Host 前缀，再复用管理员会话提交 Workspace ID 与地域并反馈失败原因。
 * - 保持表单内容可滚动、确认按钮固定在面板底部。
 *
 * Notes:
 * - API Key、连接名称和旧端点均不会进入本组件。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  DashScopeWorkspaceIdSchema,
  type DashScopeRegion,
  type DashScopeWorkspaceStatus,
} from '@echowave/contracts';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { settingsApi } from '@/shared/api/settingsApi';
import { WorkspaceRequestError } from '@/shared/api/request';
import { useAdminSession } from '@/shared/auth/AdminSessionProvider';
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
import { textInputText } from '@/shared/theme/textInput';

const REGIONS: readonly { value: DashScopeRegion; labelKey: TranslationKey }[] = [
  { value: 'cn-beijing', labelKey: 'dashscopeMigration.region.beijing' },
  { value: 'ap-southeast-1', labelKey: 'dashscopeMigration.region.singapore' },
  { value: 'ap-northeast-1', labelKey: 'dashscopeMigration.region.tokyo' },
  { value: 'eu-central-1', labelKey: 'dashscopeMigration.region.frankfurt' },
  { value: 'cn-hongkong', labelKey: 'dashscopeMigration.region.hongKong' },
  { value: 'us-east-1', labelKey: 'dashscopeMigration.region.virginia' },
];

/** 渲染迁移警告与固定底部操作面板。 */
export function DashScopeWorkspaceMigrationCard({ onMigrated }: { onMigrated: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useAppLanguage();
  const { token, clearSession } = useAdminSession();
  const [status, setStatus] = useState<DashScopeWorkspaceStatus>();
  const [visible, setVisible] = useState(false);
  const [workspaceId, setWorkspaceId] = useState('');
  const [region, setRegion] = useState<DashScopeRegion>('cn-beijing');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setStatus(await settingsApi.dashScopeWorkspaceStatus());
    } catch {
      // 状态提示不阻塞“更多”页主体；服务状态卡仍负责展示连通性。
      setStatus(undefined);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const origin = useMemo(
    () =>
      workspaceId.trim()
        ? `https://${workspaceId.trim()}.${region}.maas.aliyuncs.com`
        : `https://{workspaceId}.${region}.maas.aliyuncs.com`,
    [region, workspaceId],
  );

  const migrate = async () => {
    if (saving) return;
    if (!token) {
      setVisible(false);
      router.push('/service-configuration' as Href);
      return;
    }
    // 先用共享契约判定 API Host 前缀，避免填了完整域名时只拿到服务端的通用参数错误。
    const parsedWorkspace = DashScopeWorkspaceIdSchema.safeParse(workspaceId);
    if (!parsedWorkspace.success) {
      setError(t('dashscopeMigration.workspaceIdInvalid'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await settingsApi.migrateDashScopeWorkspace(token, {
        workspaceId: parsedWorkspace.data,
        region,
      });
      setStatus(response.workspace);
      setVisible(false);
      setWorkspaceId('');
      setRegion('cn-beijing');
      onMigrated();
    } catch (cause) {
      if (cause instanceof WorkspaceRequestError && cause.code === 'UNAUTHORIZED') {
        clearSession();
        setVisible(false);
        router.push('/service-configuration' as Href);
      } else {
        setError(cause instanceof Error ? cause.message : t('dashscopeMigration.failed'));
        if (cause instanceof WorkspaceRequestError && cause.code === 'CONFLICT') void load();
      }
    } finally {
      setSaving(false);
    }
  };

  if (!status?.migrationRequired) return null;
  return (
    <>
      <View style={styles.warningCard}>
        <View style={styles.warningIcon}>
          <Ionicons color="#9a5b00" name="warning-outline" size={22} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{t('dashscopeMigration.title')}</Text>
          <Text style={styles.description}>{t('dashscopeMigration.description')}</Text>
          <Pressable
            accessibilityLabel={t('dashscopeMigration.open')}
            accessibilityRole="button"
            onPress={() => {
              setError('');
              setVisible(true);
            }}
            style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
          >
            <Text style={styles.linkText}>{t('dashscopeMigration.open')}</Text>
          </Pressable>
        </View>
      </View>
      <Modal
        animationType="slide"
        onRequestClose={() => setVisible(false)}
        transparent
        visible={visible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.overlay}
        >
          <Pressable
            accessibilityLabel={t('common.close')}
            onPress={() => setVisible(false)}
            style={styles.backdrop}
          />
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.handle} />
            <ScrollView
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.sheetTitle}>{t('dashscopeMigration.sheetTitle')}</Text>
              <Text style={styles.sheetDescription}>
                {t('dashscopeMigration.sheetDescription')}
              </Text>
              <Text style={styles.label}>{t('dashscopeMigration.workspaceId')}</Text>
              <TextInput
                accessibilityLabel={t('dashscopeMigration.workspaceId')}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setWorkspaceId}
                placeholder="ws-xxxxxxxxxxxx"
                style={styles.input}
                value={workspaceId}
              />
              <Text style={styles.hint}>{t('dashscopeMigration.workspaceIdHint')}</Text>
              <Text style={styles.label}>{t('dashscopeMigration.regionLabel')}</Text>
              <View style={styles.regionList}>
                {REGIONS.map((item) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: region === item.value }}
                    key={item.value}
                    onPress={() => setRegion(item.value)}
                    style={[styles.regionOption, region === item.value && styles.regionSelected]}
                  >
                    <Text style={styles.regionText}>{t(item.labelKey)}</Text>
                    {region === item.value ? (
                      <Ionicons color={colors.ink} name="checkmark" size={18} />
                    ) : null}
                  </Pressable>
                ))}
              </View>
              <Text style={styles.previewLabel}>{t('dashscopeMigration.preview')}</Text>
              <Text selectable style={styles.preview}>
                {origin}
              </Text>
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
            </ScrollView>
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => setVisible(false)}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving || !workspaceId.trim()}
                onPress={() => void migrate()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (!workspaceId.trim() || saving) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.card} />
                ) : (
                  <Text style={styles.primaryText}>{t('dashscopeMigration.confirm')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  warningCard: {
    alignItems: 'flex-start',
    backgroundColor: '#fff8eb',
    borderColor: '#efb35b',
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  warningIcon: { paddingTop: 2 },
  copy: { flex: 1 },
  title: { ...typography.heading2, color: '#704100', fontFamily: fontFamilies.sansBold },
  description: { ...typography.description, color: '#84520d', marginTop: spacing.xs },
  linkButton: { alignSelf: 'flex-start', marginTop: spacing.sm, paddingVertical: spacing.xs },
  linkText: { ...typography.description, color: colors.ink, fontFamily: fontFamilies.sansBold },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    backgroundColor: 'rgba(17, 24, 39, 0.42)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: colors.divider,
    borderRadius: 2,
    height: 4,
    marginTop: spacing.sm,
    width: 42,
  },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.md },
  sheetTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  sheetDescription: {
    ...typography.description,
    color: textColors.secondary,
    marginBottom: spacing.lg,
    marginTop: spacing.xs,
  },
  label: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  input: {
    ...textInputText,
    ...typography.body,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    height: 44,
    paddingHorizontal: spacing.md,
  },
  hint: { ...typography.description, color: textColors.secondary, marginTop: spacing.xs },
  regionList: { gap: spacing.xs },
  regionOption: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  regionSelected: { backgroundColor: colors.background, borderColor: colors.ink },
  regionText: { ...typography.description, color: textColors.primary },
  previewLabel: { ...typography.description, color: textColors.secondary, marginTop: spacing.md },
  preview: { ...typography.description, color: textColors.primary, marginTop: spacing.xs },
  error: { ...typography.description, color: '#b42318', marginTop: spacing.md },
  footer: {
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  primaryText: { ...typography.body, color: colors.card, fontFamily: fontFamilies.sansBold },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
