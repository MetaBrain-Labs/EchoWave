/**
 * 音频模型执行详情内容。
 *
 * 将服务端安全审计轨迹展示为可折叠运行卡片、模型调用、执行步骤与知识检索依据。
 *
 * Responsibilities:
 * - 展示当前分析修订的全部运行尝试和失败状态。
 * - 明确区分审计摘要与不可展示的模型隐藏推理。
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
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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

function duration(value: number | null): string {
  if (value === null) return '—';
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

function RunCard({
  run,
  expanded,
  onToggle,
}: {
  run: AudioAiExecutionRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const models = [...new Set(run.modelCalls.map((call) => `${call.provider} / ${call.model}`))];
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
            {new Date(run.startedAt).toLocaleString()} · {duration(run.durationMs)}
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
            run.modelCalls.map((call) => (
              <View key={call.sequence} style={styles.detailRow}>
                <Text style={styles.detailTitle}>
                  {call.provider} · {call.model}
                </Text>
                <Text style={styles.meta}>
                  第 {call.attempt} 次 · {call.status === 'completed' ? '成功' : '失败'} ·{' '}
                  {duration(call.durationMs)}
                </Text>
                <Text style={styles.meta}>
                  Token：输入 {call.inputTokens ?? '—'} / 输出 {call.outputTokens ?? '—'}
                  {call.estimatedCost
                    ? ` · ${call.estimatedCost.amount} ${call.estimatedCost.currency}`
                    : ''}
                </Text>
              </View>
            ))
          )}

          <Text style={styles.sectionTitle}>分析过程</Text>
          {run.steps.length === 0 ? (
            <Text style={styles.emptyText}>暂无可审计步骤。</Text>
          ) : (
            run.steps.map((step) => (
              <View key={step.sequence} style={styles.timelineRow}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineContent}>
                  <Text style={styles.detailTitle}>{stepLabels[step.name] ?? step.name}</Text>
                  <Text style={styles.meta}>
                    {step.status === 'started'
                      ? '开始'
                      : step.status === 'completed'
                        ? '完成'
                        : '失败'}
                    {step.durationMs === null ? '' : ` · ${duration(step.durationMs)}`}
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
            ))
          )}

          <Text style={styles.sectionTitle}>工具与知识检索</Text>
          {run.toolCalls.length === 0 ? (
            <Text style={styles.emptyText}>本次运行未调用知识检索工具。</Text>
          ) : (
            run.toolCalls.map((tool) => (
              <View key={tool.sequence} style={styles.toolBox}>
                <Text style={styles.detailTitle}>{tool.name}</Text>
                <Text style={styles.meta}>
                  {tool.status === 'completed' ? '成功' : '失败'} · 命中 {tool.hitCount} 个知识块
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
          此处展示可审计执行摘要，不包含模型隐藏推理、完整提示词或原始输出。
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
              expanded={expandedId === run.id}
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
