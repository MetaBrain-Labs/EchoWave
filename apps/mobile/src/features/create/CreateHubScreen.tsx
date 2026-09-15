/**
 * 新建方式选择页面。
 *
 * 以与“更多”一致的导航卡片呈现一键分析和手机录音，避免把录音混入音频来源选项。
 *
 * Responsibilities:
 * - 说明两种创建方式的用途。
 * - 将具体导航动作交给路由层注入。
 *
 * Notes:
 * - 页面不持有上传、录音或分析业务状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

/** 渲染两个互相独立的新建入口。 */
export function CreateHubScreen({
  onOpenAnalysis,
  onOpenRecording,
}: {
  onOpenAnalysis: () => void;
  onOpenRecording: () => void;
}) {
  const { t } = useAppLanguage();
  const cards = [
    {
      accessibilityLabel: t('createHub.analysis.accessibility'),
      description: t('createHub.analysis.description'),
      id: 'analysis',
      icon: 'sparkles-outline' as const,
      onPress: onOpenAnalysis,
      title: t('createHub.analysis.title'),
    },
    {
      accessibilityLabel: t('createHub.recording.accessibility'),
      description: t('createHub.recording.description'),
      id: 'recording',
      icon: 'mic-outline' as const,
      onPress: onOpenRecording,
      title: t('createHub.recording.title'),
    },
  ];
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <TopLevelPageHeader subtitle={t('createHub.subtitle')} title={t('createHub.title')} />
      <ScrollView contentContainerStyle={styles.content} testID="create-hub-scroll">
        {cards.map((card) => (
          <Pressable
            accessibilityLabel={card.accessibilityLabel}
            accessibilityRole="button"
            key={card.title}
            onPress={card.onPress}
            style={({ pressed }) => [styles.navigationCard, pressed && styles.pressed]}
          >
            <View style={styles.navigationIcon} testID={`create-hub-icon-${card.id}`}>
              <Ionicons color={colors.ink} name={card.icon} size={22} />
            </View>
            <View style={styles.navigationCopy}>
              <Text style={styles.navigationTitle}>{card.title}</Text>
              <Text style={styles.navigationText}>{card.description}</Text>
            </View>
            <Ionicons color={textColors.tertiary} name="chevron-forward" size={22} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  content: {
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  navigationCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.base,
    minHeight: 112,
    padding: spacing.md,
  },
  navigationIcon: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  navigationCopy: { flex: 1, minHeight: 64, justifyContent: 'center' },
  navigationTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginBottom: spacing.xs,
  },
  navigationText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  pressed: { backgroundColor: colors.background },
});
