/**
 * 管理员会话门禁。
 *
 * 未通过校验时用锁定卡片替代页面正文，避免用户在缺少口令的页面上重复填写同一口令。
 *
 * Responsibilities:
 * - 只在共享会话已建立时渲染受保护内容。
 * - 未建立时给出明确原因与唯一校验入口。
 *
 * Notes:
 * - 口令校验集中在“服务配置”页；本组件只做展示与导航，不读取或保存口令。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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

/** 渲染受管理员会话保护的页面内容，或未校验时的说明与跳转。 */
export function AdminSessionGate({
  children,
  onOpenServiceConfiguration,
}: {
  children?: ReactNode;
  onOpenServiceConfiguration: () => void;
}) {
  const { t } = useAppLanguage();
  const { token } = useAdminSession();
  if (token) return <>{children}</>;

  return (
    <View style={styles.container} testID="admin-session-required">
      <View style={styles.card}>
        <View style={styles.icon}>
          <Ionicons color={colors.secondary} name="lock-closed-outline" size={22} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {t('adminSession.requiredTitle')}
        </Text>
        <Text style={styles.description}>{t('adminSession.requiredDescription')}</Text>
        <Pressable
          accessibilityLabel={t('adminSession.openServiceConfiguration')}
          accessibilityRole="button"
          onPress={onOpenServiceConfiguration}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>{t('adminSession.openServiceConfiguration')}</Text>
          <Ionicons color={colors.white} name="chevron-forward" size={18} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    paddingTop: spacing.xxl,
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.lg,
    width: '100%',
  },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.round,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  title: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    width: '100%',
  },
  buttonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  pressed: { opacity: 0.8 },
});
