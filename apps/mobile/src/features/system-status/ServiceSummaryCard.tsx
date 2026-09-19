/**
 * “更多”页服务状态摘要卡。
 *
 * 让最常见的疑问“服务器是否在线、当前是什么运行模式”在更多页首屏直接得到答案。
 *
 * Responsibilities:
 * - 聚合公开的健康检查与租户运行模式，渲染为只读文字摘要。
 * - 允许进入完整服务状态页面查看版本、重试与推送登记。
 * - 请求失败时降级为“无法连接”，不阻塞更多页导航。
 *
 * Notes:
 * - 只做只读观测，不缓存也不写入任何权威状态；PostgreSQL 与运行模式服务仍是事实来源。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { AudioRuntimeOverview } from '@echowave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';
import { useServerConnection } from '@/shared/api/ServerConnectionProvider';
import { fetchServerHealth } from '@/shared/api/serverHealth';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
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

type ServerSummary =
  { phase: 'loading' } | { phase: 'online'; version: string } | { phase: 'offline' };

const runtimeModeKeys = {
  hybrid: 'runtime.hybrid',
  object_storage: 'runtime.objectStorage',
  lightweight_local: 'runtime.lightweight',
} as const satisfies Record<AudioRuntimeOverview['mode'], TranslationKey>;

/** 渲染服务器连通、运行模式与对象存储可用性的只读摘要。 */
export function ServiceSummaryCard({ onOpenDetails }: { onOpenDetails: () => void }) {
  const { t } = useAppLanguage();
  const { serverUrl } = useServerConnection();
  const [server, setServer] = useState<ServerSummary>(
    serverUrl ? { phase: 'loading' } : { phase: 'offline' },
  );
  const [runtime, setRuntime] = useState<AudioRuntimeOverview | null>(null);

  // 只读取公开信息；未配置服务器时直接降级为离线，不做任何健康请求。
  const load = useCallback(async () => {
    const [health, overview] = await Promise.allSettled([
      serverUrl ? fetchServerHealth(serverUrl) : Promise.reject(new Error('unconfigured')),
      getAudioRuntime(),
    ]);
    setServer(
      health.status === 'fulfilled'
        ? { phase: 'online', version: health.value.version }
        : { phase: 'offline' },
    );
    setRuntime(overview.status === 'fulfilled' ? overview.value : null);
  }, [serverUrl]);

  // 首次挂载立即取样一次；之后的重新聚焦由 useScreenRefresh 统一接管。
  useEffect(() => {
    void Promise.allSettled([
      serverUrl ? fetchServerHealth(serverUrl) : Promise.reject(new Error('unconfigured')),
      getAudioRuntime(),
    ]).then(([health, overview]) => {
      setServer(
        health.status === 'fulfilled'
          ? { phase: 'online', version: health.value.version }
          : { phase: 'offline' },
      );
      setRuntime(overview.status === 'fulfilled' ? overview.value : null);
    });
  }, [serverUrl]);
  useScreenRefresh(load);

  const runtimeSelected = runtime?.modes.find((mode) => mode.mode === runtime.mode);
  const runtimeValue = runtime
    ? `${t(runtimeModeKeys[runtime.mode])}${
        // 只有已知的不可用原因才展示，避免把空字符串渲染成多余分隔符。
        runtimeSelected && !runtimeSelected.available && runtimeSelected.unavailableReason
          ? ` · ${runtimeSelected.unavailableReason}`
          : ''
      }`
    : t('moreSummary.runtimeUnknown');
  const online = server.phase === 'online';

  return (
    <Pressable
      accessibilityLabel={t('moreSummary.accessibility')}
      accessibilityRole="button"
      onPress={onOpenDetails}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.headingRow}>
        <Text style={styles.title}>{t('moreSummary.title')}</Text>
        <View
          accessibilityLabel={
            server.phase === 'loading'
              ? t('service.checking')
              : online
                ? t('service.online')
                : t('service.offline')
          }
          style={[styles.badge, online ? styles.onlineBadge : styles.neutralBadge]}
        >
          {server.phase === 'loading' ? (
            <ActivityIndicator color={colors.secondary} size={typography.label.lineHeight} />
          ) : (
            <Ionicons
              color={online ? colors.success : colors.secondary}
              name={online ? 'checkmark-circle' : 'cloud-offline-outline'}
              size={typography.label.lineHeight}
            />
          )}
          <Text style={[styles.badgeLabel, online && styles.onlineBadgeLabel]}>
            {server.phase === 'loading'
              ? t('service.checking')
              : online
                ? t('service.online')
                : t('service.offline')}
          </Text>
        </View>
      </View>
      <SummaryRow
        label={t('moreSummary.serverLabel')}
        value={online ? `EchoWave ${server.version}` : t('moreSummary.serverUnreachable')}
      />
      <SummaryRow label={t('moreSummary.runtimeLabel')} value={runtimeValue} />
      <View style={styles.detailsRow}>
        <Text style={styles.detailsLabel}>{t('moreSummary.details')}</Text>
        <Ionicons color={textColors.tertiary} name="chevron-forward" size={18} />
      </View>
    </Pressable>
  );
}

/** 渲染一条“标签 + 只读值”的摘要行。 */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.summaryValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  pressed: { backgroundColor: colors.background },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  badge: {
    alignItems: 'center',
    borderRadius: radii.round,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  onlineBadge: { backgroundColor: colors.successSurface },
  neutralBadge: { backgroundColor: colors.background },
  badgeLabel: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  onlineBadgeLabel: { color: textColors.primary },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  summaryLabel: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  summaryValue: {
    ...typography.description,
    color: textColors.primary,
    flexShrink: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  detailsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'flex-end',
  },
  detailsLabel: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
});
