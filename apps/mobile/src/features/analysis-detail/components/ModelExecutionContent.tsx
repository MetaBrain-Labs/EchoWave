/**
 * 音频模型执行详情内容。
 *
 * 将服务端安全审计轨迹展示为可折叠运行卡片、模型调用、执行步骤与知识检索依据。
 *
 * Responsibilities:
 * - 展示当前分析修订的全部运行尝试和失败状态。
 * - 区分供应商原始 reasoning、审计摘要与不会展示的提示词和最终原文。
 *
 * Notes:
 * - 不渲染提示词、模型原始输出、知识块正文或本地诊断文件。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type {
  AudioAiExecutionRun,
  AudioAiExecutionTraceResponse,
  SourceLocator,
} from '@echowave/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

const kindLabels: Record<AudioAiExecutionRun['kind'], string> = {
  'audio-transcription': 'ASR 转写',
  'audio-emotion-analysis': '情绪分析',
  'audio-role-recognition': '角色识别',
  'audio-business-analysis': '业务分析',
};

const statusLabels: Record<AudioAiExecutionRun['status'], string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
};

const stepLabels: Record<string, string> = {
  'preprocess-whole-file': '准备整段音频',
  'oss-staging-upload': '暂存音频文件',
  'dashscope-submit': '提交转写任务',
  'dashscope-terminal-result': '读取供应商终态结果',
  publish: '校验并发布结果',
  'oss-staging-cleanup': '清理临时音频',
  'persist-failure': '保存失败状态',
  'cleanup-failure': '清理失败现场',
  'retrieval-planning': '规划知识检索',
  'analysis-generation': '生成业务分析',
};
const reasoningBottomThreshold = 24;

function duration(value: number | null): string {
  if (value === null) return '—';
  if (value < 1) return '<1 ms';
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
}

function locatorLabel(locator: SourceLocator): string {
  if (locator.kind === 'spreadsheet') {
    return `${locator.sheet} · 第 ${locator.rowStart}-${locator.rowEnd} 行`;
  }
  const heading = locator.headingPath.join(' / ');
  if (locator.kind === 'markdown') {
    return `${heading ? `${heading} · ` : ''}第 ${locator.lineStart}-${locator.lineEnd} 行`;
  }
  return `${heading ? `${heading} · ` : ''}第 ${locator.paragraphStart}-${locator.paragraphEnd} 段`;
}

function statusColor(status: AudioAiExecutionRun['status']): string {
  if (status === 'completed') return colors.success;
  if (status === 'failed' || status === 'interrupted') return colors.danger;
  return colors.secondary;
}

/** 在有限高度内展示推理流，并在用户未查看历史内容时持续追踪最新 Token。 */
function ReasoningViewport({ call }: { call: AudioAiExecutionRun['modelCalls'][number] }) {
  const scrollRef = useRef<ScrollView>(null);
  const followingLatestRef = useRef(true);
  const userScrollingRef = useRef(false);
  const [followingLatest, setFollowingLatestState] = useState(true);
  const setFollowingLatest = useCallback((value: boolean) => {
    followingLatestRef.current = value;
    setFollowingLatestState(value);
  }, []);
  const scrollToLatest = useCallback((animated: boolean) => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
  }, []);
  const updateFollowingFromScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distanceFromBottom = Math.max(
        0,
        contentSize.height - layoutMeasurement.height - contentOffset.y,
      );
      setFollowingLatest(distanceFromBottom <= reasoningBottomThreshold);
    },
    [setFollowingLatest],
  );

  useEffect(() => {
    // 视口重新展开时应从最新内容开始，不继承上一次已销毁视口的暂停状态。
    scrollToLatest(false);
  }, [scrollToLatest]);

  const handleContentSizeChange = useCallback(() => {
    if (followingLatestRef.current) scrollToLatest(false);
  }, [scrollToLatest]);
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (userScrollingRef.current) updateFollowingFromScroll(event);
    },
    [updateFollowingFromScroll],
  );
  const handleScrollBeginDrag = useCallback(() => {
    userScrollingRef.current = true;
  }, []);
  const handleScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateFollowingFromScroll(event);
      userScrollingRef.current = false;
    },
    [updateFollowingFromScroll],
  );
  const handleMomentumScrollBegin = useCallback(() => {
    userScrollingRef.current = true;
  }, []);
  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateFollowingFromScroll(event);
      userScrollingRef.current = false;
    },
    [updateFollowingFromScroll],
  );
  const resumeFollowing = useCallback(() => {
    setFollowingLatest(true);
    scrollToLatest(true);
  }, [scrollToLatest, setFollowingLatest]);

  return (
    <View>
      <ScrollView
        accessibilityLabel="原始推理内容"
        nestedScrollEnabled
        onContentSizeChange={handleContentSizeChange}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        ref={scrollRef}
        scrollEventThrottle={16}
        style={styles.reasoningScroll}
        testID={`reasoning-scroll-${call.id}`}
      >
        <Text selectable style={styles.reasoningText}>
          {call.reasoningContent ||
            (call.status === 'running' ? '等待模型返回推理内容…' : '该调用未提供推理流。')}
        </Text>
      </ScrollView>
      {!followingLatest ? (
        <View style={styles.followLatestBar}>
          <Pressable
            accessibilityRole="button"
            onPress={resumeFollowing}
            style={({ pressed }) => [styles.followLatestButton, pressed && styles.pressed]}
          >
            <Ionicons color={colors.secondary} name="arrow-down" size={14} />
            <Text style={styles.followLatestText}>回到最新</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ModelCallCard({ call }: { call: AudioAiExecutionRun['modelCalls'][number] }) {
  const [expanded, setExpanded] = useState(false);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (call.status !== 'running') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [call.status]);
  const visibleDuration =
    call.durationMs ??
    (call.status === 'running' ? Math.max(0, now - new Date(call.startedAt).getTime()) : null);
  const callStatus =
    call.status === 'running' ? '运行中' : call.status === 'completed' ? '成功' : '失败';
  return (
    <View style={styles.modelCallCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.modelCallHeader, pressed && styles.pressed]}
      >
        <View style={styles.cardTitleArea}>
          <Text style={styles.detailTitle}>{call.name}</Text>
          <Text style={styles.meta}>
            {call.provider} · {call.model}
          </Text>
          <Text style={styles.meta}>
            第 {call.attempt} 次 · {callStatus} · {duration(visibleDuration)}
          </Text>
        </View>
        <Ionicons
          color={colors.secondary}
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.modelCallBody}>
          <Text style={styles.bodyText}>当前关注事项：{call.name}</Text>
          <Text style={styles.meta}>
            Token：输入 {call.inputTokens ?? '—'} / 输出 {call.outputTokens ?? '—'}
            {call.estimatedCost
              ? ` · ${call.estimatedCost.amount} ${call.estimatedCost.currency}`
              : ''}
          </Text>
          {call.reasoningMode === 'streaming' || call.reasoningContent ? (
            <View style={styles.reasoningBox}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: reasoningExpanded }}
                onPress={() => setReasoningExpanded((current) => !current)}
                style={({ pressed }) => [styles.reasoningHeader, pressed && styles.pressed]}
              >
                <Text style={styles.detailTitle}>原始推理</Text>
                <Text style={styles.meta}>{reasoningExpanded ? '收起' : '展开'}</Text>
              </Pressable>
              {reasoningExpanded ? <ReasoningViewport call={call} /> : null}
              {call.reasoningTruncated ? (
                <Text style={styles.truncatedText}>已达到 120,000 字保存上限。</Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.emptyText}>
              {call.reasoningMode === 'disabled'
                ? '该调用未开启思考模式。'
                : '该调用未提供推理流。'}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function RunCard({
  run,
  expanded,
  onToggle,
}: {
  run: AudioAiExecutionRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (run.status !== 'running') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [run.status]);
  const models = [...new Set(run.modelCalls.map((call) => `${call.provider} / ${call.model}`))];
  const visibleRunDuration =
    run.durationMs ??
    (run.status === 'running' ? Math.max(0, now - new Date(run.startedAt).getTime()) : null);
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.cardHeader, pressed && styles.pressed]}
      >
        <View style={styles.cardTitleArea}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>{kindLabels[run.kind]}</Text>
            <Text style={[styles.status, { color: statusColor(run.status) }]}>
              {statusLabels[run.status]}
            </Text>
          </View>
          <Text style={styles.meta}>
            {new Date(run.startedAt).toLocaleString()} · {duration(visibleRunDuration)}
          </Text>
          <Text numberOfLines={2} style={styles.meta}>
            {models.length > 0 ? models.join('、') : '尚无模型调用记录'}
          </Text>
        </View>
        <Ionicons
          color={colors.secondary}
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.cardBody}>
          {run.error ? (
            <View accessibilityRole="alert" style={styles.errorBox}>
              <Text style={styles.errorTitle}>{run.error.code}</Text>
              <Text style={styles.bodyText}>{run.error.message}</Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>模型调用</Text>
          {run.modelCalls.length === 0 ? (
            <Text style={styles.emptyText}>此阶段没有独立模型调用记录。</Text>
          ) : (
            run.modelCalls.map((call) => <ModelCallCard call={call} key={call.id} />)
          )}

          <Text style={styles.sectionTitle}>分析过程</Text>
          {run.steps.length === 0 ? (
            <Text style={styles.emptyText}>暂无可审计步骤。</Text>
          ) : (
            run.steps.map((step) => {
              const visibleStepDuration =
                step.durationMs ??
                (step.status === 'started'
                  ? Math.max(0, now - new Date(step.occurredAt).getTime())
                  : null);
              return (
                <View key={step.id} style={styles.timelineRow}>
                  <View style={styles.timelineDot} />
                  <View style={styles.timelineContent}>
                    <Text style={styles.detailTitle}>{stepLabels[step.name] ?? step.name}</Text>
                    <Text style={styles.meta}>
                      {step.status === 'started'
                        ? '运行中'
                        : step.status === 'completed'
                          ? '完成'
                          : '失败'}
                      {visibleStepDuration === null ? '' : ` · ${duration(visibleStepDuration)}`}
                    </Text>
                    {Object.keys(step.summary).length > 0 ? (
                      <Text style={styles.summaryText}>
                        {Object.entries(step.summary)
                          .map(([key, value]) => `${key}: ${String(value)}`)
                          .join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}

          <Text style={styles.sectionTitle}>工具与知识检索</Text>
          {run.toolCalls.length === 0 ? (
            <Text style={styles.emptyText}>本次运行未调用知识检索工具。</Text>
          ) : (
            run.toolCalls.map((tool) => (
              <View key={tool.id} style={styles.toolBox}>
                <Text style={styles.detailTitle}>{tool.name}</Text>
                <Text style={styles.meta}>
                  {tool.status === 'running'
                    ? '运行中'
                    : tool.status === 'completed'
                      ? '成功'
                      : '失败'}{' '}
                  · 命中 {tool.hitCount} 个知识块
                </Text>
                {tool.query ? <Text style={styles.query}>查询：{tool.query}</Text> : null}
                <Text style={styles.meta}>
                  知识库：
                  {tool.knowledgeBases.length > 0
                    ? tool.knowledgeBases.map((item) => item.name).join('、')
                    : '无'}
                </Text>
                {tool.hits.map((hit) => (
                  <View key={hit.chunkId} style={styles.hitRow}>
                    <Text style={styles.hitTitle}>{hit.documentTitle}</Text>
                    <Text style={styles.meta}>{locatorLabel(hit.locator)}</Text>
                  </View>
                ))}
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

/** 渲染模型详情标签页的加载、错误、空态与执行卡片。 */
export function ModelExecutionContent({
  error,
  loading,
  onRetry,
  trace,
}: {
  error: string;
  loading: boolean;
  onRetry: () => void;
  trace?: AudioAiExecutionTraceResponse;
}) {
  const [expandedId, setExpandedId] = useState<string>();

  return (
    <ScrollView contentContainerStyle={styles.container} testID="model-execution-scroll">
      <View style={styles.notice}>
        <Ionicons color={colors.secondary} name="shield-checkmark-outline" size={20} />
        <Text style={styles.noticeText}>
          原始推理属于模型未验证的中间过程，不代表最终结论；完整提示词和原始最终输出仍不展示。
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator accessibilityLabel="正在加载模型执行详情" color={colors.ink} />
      ) : null}
      {!loading && error ? (
        <View accessibilityRole="alert" style={styles.centered}>
          <Text style={styles.errorTitle}>模型详情加载失败</Text>
          <Text style={styles.bodyText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
            <Text style={styles.retryText}>重新加载</Text>
          </Pressable>
        </View>
      ) : null}
      {!loading && !error && trace?.runs.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>暂无执行轨迹</Text>
          <Text style={styles.bodyText}>该分析可能生成于执行轨迹功能启用前。</Text>
        </View>
      ) : null}
      {!loading && !error
        ? trace?.runs.map((run) => (
            <RunCard
              expanded={expandedId === run.id || run.status === 'running'}
              key={run.id}
              onToggle={() => setExpandedId((current) => (current === run.id ? undefined : run.id))}
              run={run}
            />
          ))
        : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  notice: {
    alignItems: 'flex-start',
    backgroundColor: colors.successSurface,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noticeText: {
    ...typography.description,
    color: textColors.secondary,
    flex: 1,
    fontFamily: fontFamilies.sans,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  cardTitleArea: { flex: 1, gap: spacing.xs },
  cardTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  cardTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  status: { ...typography.description, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  meta: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  cardBody: {
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginTop: spacing.sm,
  },
  detailRow: {
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  modelCallCard: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    overflow: 'hidden',
  },
  modelCallHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  modelCallBody: {
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  reasoningBox: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  reasoningHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  reasoningText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    lineHeight: 20,
    padding: spacing.sm,
    paddingTop: 0,
  },
  reasoningScroll: {
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: 240,
  },
  followLatestBar: {
    alignItems: 'flex-end',
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.xs,
  },
  followLatestButton: {
    alignItems: 'center',
    borderRadius: radii.round,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  followLatestText: {
    ...typography.label,
    color: colors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  truncatedText: {
    ...typography.label,
    color: colors.danger,
    fontFamily: fontFamilies.sans,
    padding: spacing.sm,
    paddingTop: 0,
  },
  detailTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  emptyText: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  timelineRow: { flexDirection: 'row', gap: spacing.sm },
  timelineDot: {
    backgroundColor: colors.secondary,
    borderRadius: radii.round,
    height: 8,
    marginTop: 6,
    width: 8,
  },
  timelineContent: { flex: 1, gap: spacing.xs, paddingBottom: spacing.sm },
  summaryText: { ...typography.label, color: textColors.secondary, fontFamily: fontFamilies.sans },
  toolBox: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  query: { ...typography.description, color: textColors.primary, fontFamily: fontFamilies.sans },
  hitRow: {
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  hitTitle: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  errorBox: {
    backgroundColor: colors.background,
    borderLeftColor: colors.danger,
    borderLeftWidth: 3,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  errorTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  bodyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  centered: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  retryButton: {
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  pressed: { backgroundColor: colors.background },
});
