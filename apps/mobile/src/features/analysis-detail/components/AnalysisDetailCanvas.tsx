/**
 * 分析详情公共展示骨架。
 *
 * 统一真实分析与模板示例的源文件提示、标签页、横向分页、转写时间轴、摘要和 AI 标签面板。
 *
 * Responsibilities:
 * - 组合分析详情的稳定视觉结构。
 * - 允许真实分析注入任务、模型和播放器，模板注入只读内容。
 *
 * Notes:
 * - 本组件不持有业务请求、任务创建或播放状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Ref, ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useSwipePager } from '@/shared/hooks/useSwipePager';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';
import type { AnalysisDetailView, AiTagAnalysis, TranscriptSegment } from '../model';
import { AiTagPanel } from './AiTagPanel';
import { IconButton } from './AnalysisControls';
import { DetailTabs, type AnalysisTab } from './AnalysisTabs';
import { SummaryContent, type SummaryContentProps } from './SummaryContent';
import { TranscriptContent, type TranscriptContentProps } from './TranscriptContent';

/** 统一渲染源音频不可用时的返回提示。 */
export function AnalysisSourceUnavailableCard({
  description,
  onBack,
  showBackButton = true,
  testID = 'analysis-source-unavailable',
  title,
}: {
  description: string;
  onBack: () => void;
  showBackButton?: boolean;
  testID?: string;
  title: string;
}) {
  const { t } = useAppLanguage();
  return (
    <View accessibilityRole="alert" style={styles.sourceUnavailableCard} testID={testID}>
      {showBackButton ? (
        <IconButton icon="chevron-back" label={t('common.back')} onPress={onBack} />
      ) : null}
      <Ionicons color={colors.secondary} name="volume-mute-outline" size={24} />
      <View style={styles.sourceUnavailableCopy}>
        <Text style={styles.sourceUnavailableTitle}>{title}</Text>
        <Text style={styles.sourceUnavailableDescription}>{description}</Text>
      </View>
    </View>
  );
}

export type AnalysisDetailCanvasProps = {
  activeTab: AnalysisTab;
  audioExpanded?: boolean;
  detail: AnalysisDetailView;
  hideIrrelevant: boolean;
  modelContent?: ReactNode;
  onChangeTab: (tab: AnalysisTab) => void;
  onCloseTag: () => void;
  onHideIrrelevantChange: (value: boolean) => void;
  onOpenCitation?: (knowledgeBaseId: string, documentId: string, chunkId: string) => void;
  selectedTag?: AiTagAnalysis;
  showTagFilter?: boolean;
  summary?: Omit<SummaryContentProps, 'detail'>;
  summaryLeadingContent?: ReactNode;
  summaryTargetRef?: Ref<View>;
  tagSegments?: readonly TranscriptSegment[];
  tasksContent?: ReactNode;
  tabsInsidePages?: boolean;
  topContent: ReactNode;
  transcript: Omit<TranscriptContentProps, 'detail'>;
  transcriptLeadingContent?: ReactNode;
  transcriptTargetRef?: Ref<View>;
};

/** 组合分析详情的公共分页骨架，真实页和模板页只负责注入内容与状态。 */
export function AnalysisDetailCanvas({
  activeTab,
  audioExpanded = false,
  detail,
  hideIrrelevant,
  modelContent,
  onChangeTab,
  onCloseTag,
  onHideIrrelevantChange,
  onOpenCitation,
  selectedTag,
  showTagFilter = true,
  summary,
  summaryLeadingContent,
  summaryTargetRef,
  tagSegments,
  tasksContent,
  tabsInsidePages = false,
  topContent,
  transcript,
  transcriptLeadingContent,
  transcriptTargetRef,
}: AnalysisDetailCanvasProps) {
  const { t } = useAppLanguage();
  const tabs = [
    'transcript',
    ...(tasksContent === undefined ? [] : ['tasks']),
    ...(summary === undefined ? [] : ['summary']),
    ...(modelContent === undefined ? [] : ['model']),
  ] as AnalysisTab[];
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } = useSwipePager({
    activeTab,
    onTabChange: onChangeTab,
    tabs,
  });
  const segments = tagSegments ?? detail.scenes.flatMap((scene) => scene.segments);
  const pageTabs = <DetailTabs activeTab={activeTab} onChange={selectTab} visibleTabs={tabs} />;

  return (
    <>
      {topContent}
      {tabsInsidePages ? null : pageTabs}
      <ScrollView
        accessibilityLabel={t('analysisDetail.pager')}
        directionalLockEnabled
        horizontal
        nestedScrollEnabled
        onMomentumScrollEnd={handleMomentumScrollEnd}
        pagingEnabled
        ref={pagerRef}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        testID="analysis-tab-pager"
      >
        <View
          collapsable={false}
          ref={transcriptTargetRef}
          style={[styles.page, { width: pageWidth }]}
          testID="analysis-transcript-page"
        >
          <TranscriptContent
            detail={detail}
            {...transcript}
            leadingContent={
              tabsInsidePages ? (
                <>
                  {transcriptLeadingContent}
                  {pageTabs}
                </>
              ) : (
                transcript.leadingContent
              )
            }
          />
        </View>
        {tasksContent !== undefined ? (
          <View style={[styles.page, { width: pageWidth }]} testID="analysis-tasks-page">
            {tasksContent}
          </View>
        ) : null}
        {summary !== undefined ? (
          <View
            collapsable={false}
            ref={summaryTargetRef}
            style={[styles.page, { width: pageWidth }]}
            testID="analysis-summary-page"
          >
            <SummaryContent
              detail={detail}
              {...summary}
              leadingContent={
                tabsInsidePages ? (
                  <>
                    {summaryLeadingContent}
                    {pageTabs}
                  </>
                ) : (
                  summary.leadingContent
                )
              }
            />
          </View>
        ) : null}
        {modelContent !== undefined ? (
          <View style={[styles.page, { width: pageWidth }]} testID="analysis-model-page">
            {modelContent}
          </View>
        ) : null}
      </ScrollView>
      <AiTagPanel
        allowHideIrrelevant={showTagFilter}
        analysis={selectedTag}
        audioExpanded={audioExpanded}
        hideIrrelevant={hideIrrelevant}
        onClose={onCloseTag}
        onHideIrrelevantChange={onHideIrrelevantChange}
        onOpenCitation={onOpenCitation}
        segments={segments.filter((segment) =>
          selectedTag?.evidenceSegmentIds.includes(segment.id),
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  pager: { flex: 1 },
  page: { height: '100%' },
  sourceUnavailableCard: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 80,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sourceUnavailableCopy: { flex: 1 },
  sourceUnavailableTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  sourceUnavailableDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
});
