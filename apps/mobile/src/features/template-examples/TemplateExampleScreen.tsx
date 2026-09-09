/**
 * 起步模板只读分析示例页。
 *
 * 加载模板示例并注入分析详情公共展示骨架，明确区分真实音频分析和不可播放的产品示例。
 *
 * Responsibilities:
 * - 呈现与真实分析一致的标签页、转写时间轴、角色情绪、AI 标签和分析总结。
 * - 仅保留示例查看与失败重试，不触发播放、任务创建或业务写入。
 *
 * Notes:
 * - TemplateExample 到分析展示模型的转换由独立适配器负责。
 */
import type { TemplateExample } from '@echowave/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getGroupTemplateExample } from '@/shared/api/groupsApi';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';
import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';
import {
  AnalysisDetailCanvas,
  AnalysisSourceUnavailableCard,
} from '@/features/analysis-detail/components/AnalysisDetailCanvas';
import type { AnalysisTab } from '@/features/analysis-detail/components/AnalysisTabs';
import { toTemplateAnalysisView } from './templateAnalysisAdapter';

/** 呈现指定模板分组的只读分析示例。 */
export function TemplateExampleScreen({
  groupId,
  onBack,
}: {
  groupId: string;
  onBack: () => void;
}) {
  const { formatNumber, language, t } = useAppLanguage();
  const [example, setExample] = useState<TemplateExample>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<AnalysisTab>('transcript');
  const [selectedTag, setSelectedTag] =
    useState<
      ReturnType<
        typeof toTemplateAnalysisView
      >['scenes'][number]['segments'][number]['aiTags'][number]
    >();
  const overviewRef = useStarterTourTarget('example-overview');
  const transcriptRef = useStarterTourTarget('example-transcript', () =>
    setActiveTab('transcript'),
  );
  const reportRef = useStarterTourTarget('example-report', () => setActiveTab('summary'));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setExample(await getGroupTemplateExample(groupId, language));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('templateExample.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [groupId, language, t]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const detail = useMemo(
    () => (example ? toTemplateAnalysisView(example, language) : undefined),
    [example, language],
  );

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <TopLevelPageHeader
        onBack={onBack}
        subtitle={t('templateExample.subtitle')}
        title={t('templateExample.title')}
      />
      {loading ? (
        <ActivityIndicator
          accessibilityLabel={t('templateExample.loading')}
          color={colors.ink}
          style={styles.loader}
        />
      ) : null}
      {!loading && error ? (
        <View style={styles.stateCard}>
          <Text accessibilityRole="alert" style={styles.secondary}>
            {error}
          </Text>
          <Text accessibilityRole="button" onPress={() => void load()} style={styles.retryText}>
            {t('common.reload')}
          </Text>
        </View>
      ) : null}
      {!loading && detail && example ? (
        <AnalysisDetailCanvas
          activeTab={activeTab}
          detail={detail}
          hideIrrelevant={false}
          onChangeTab={setActiveTab}
          onCloseTag={() => setSelectedTag(undefined)}
          onHideIrrelevantChange={() => undefined}
          selectedTag={selectedTag}
          showTagFilter={false}
          summaryLeadingContent={null}
          summary={{
            generatedAt: '',
            limitations: example.limitations,
            limitationsTitle: t('templateExample.limitations'),
            onRefresh: () => void load(),
            recommendations: example.recommendations,
            recommendationsTitle: t('templateExample.improvements'),
            refreshing: loading,
          }}
          summaryTargetRef={reportRef}
          tagSegments={detail.scenes.flatMap((scene) => scene.segments)}
          tabsInsidePages
          topContent={null}
          transcriptLeadingContent={
            <>
              <View collapsable={false} ref={overviewRef} style={styles.overviewCard}>
                <View style={styles.badgeRow}>
                  <Text style={styles.badge}>{t('templateExample.readonly')}</Text>
                  <Text style={styles.version}>
                    {t('templateExample.version', {
                      version: formatNumber(example.exampleVersion),
                    })}
                  </Text>
                </View>
                <Text accessibilityRole="header" style={styles.title}>
                  {example.title}
                </Text>
                <Text style={styles.secondary}>{example.scenario}</Text>
                <Text style={styles.roles}>
                  {t('templateExample.roles', {
                    roles: example.roles
                      .map((role) => role.label)
                      .join(language === 'zh-CN' ? '、' : ', '),
                  })}
                </Text>
              </View>
              <AnalysisSourceUnavailableCard
                description={t('templateExample.noAudioDescription')}
                onBack={onBack}
                showBackButton={false}
                testID="template-source-unavailable"
                title={t('templateExample.noAudio')}
              />
            </>
          }
          transcript={{
            confirming: false,
            displayMode: 'current',
            draftSegments: detail.scenes.flatMap((scene) => scene.segments),
            editing: false,
            hideIrrelevant: false,
            onCancelEditing: () => undefined,
            onConfirmEditing: () => undefined,
            onDisplayModeChange: () => undefined,
            onDraftChange: () => undefined,
            onOpenAiTag: setSelectedTag,
            onOpenEmotion: () => undefined,
            onPlaySegment: () => undefined,
            onPlayReviewFinding: () => undefined,
            onResolveAllReviewFindings: () => undefined,
            onResolveReviewFinding: () => undefined,
            onSpeakerChange: () => undefined,
            onSplitSegment: () => undefined,
            onStartEditing: () => undefined,
            readOnly: true,
            reviewPlaybackAvailable: false,
            segmentPlaybackDisabled: true,
            segmentPlaybackLoading: false,
            segmentPlaybackPlaying: false,
            selectedSegmentIds: selectedTag?.evidenceSegmentIds ?? [],
            onRefresh: () => void load(),
            refreshing: loading,
          }}
          transcriptTargetRef={transcriptRef}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  loader: { marginTop: spacing.xxl },
  stateCard: {
    backgroundColor: colors.card,
    gap: spacing.md,
    margin: spacing.md,
    padding: spacing.md,
  },
  secondary: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  retryText: {
    ...typography.description,
    color: colors.ink,
    fontFamily: fontFamilies.sansBold,
    paddingVertical: spacing.xs,
  },
  overviewCard: {
    backgroundColor: colors.card,
    gap: spacing.sm,
    padding: spacing.md,
  },
  badgeRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  badge: {
    ...typography.label,
    backgroundColor: colors.successSurface,
    borderRadius: 4,
    color: colors.success,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  version: { ...typography.label, color: textColors.tertiary },
  title: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  roles: { ...typography.description, color: textColors.primary },
});
