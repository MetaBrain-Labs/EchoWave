/**
 * 起步模板只读分析示例页。
 *
 * 加载并展示代码维护的示例转写与报告，明确区分真实音频分析和不可播放的产品示例。
 *
 * Responsibilities:
 * - 呈现场景、角色、转写证据、摘要、标签、建议和限制。
 * - 为“查看分析”引导注册稳定的只读目标。
 *
 * Notes:
 * - 本页不触发播放、任务创建或任何业务写入。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { TemplateExample } from '@echowave/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getGroupTemplateExample } from '@/shared/api/groupsApi';
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';

function formatTime(value: number): string {
  const seconds = Math.floor(value / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** 呈现指定模板分组的专用只读详情。 */
export function TemplateExampleScreen({
  groupId,
  onBack,
}: {
  groupId: string;
  onBack: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const prepareTranscript = useCallback(
    () => scrollRef.current?.scrollTo({ animated: true, y: 180 }),
    [],
  );
  const prepareReport = useCallback(
    () => scrollRef.current?.scrollTo({ animated: true, y: 760 }),
    [],
  );
  const [example, setExample] = useState<TemplateExample>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const overviewRef = useStarterTourTarget('example-overview');
  const transcriptRef = useStarterTourTarget('example-transcript', prepareTranscript);
  const reportRef = useStarterTourTarget('example-report', prepareReport);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setExample(await getGroupTemplateExample(groupId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模板示例加载失败。');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <TopLevelPageHeader
        onBack={onBack}
        subtitle="产品内置内容，不会写入你的分析数据。"
        title="模板分析示例"
      />
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="正在加载模板分析示例"
          color={colors.ink}
          style={styles.loader}
        />
      ) : null}
      {!loading && error ? (
        <View style={styles.stateCard}>
          <Text accessibilityRole="alert" style={styles.secondary}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>重新加载</Text>
          </Pressable>
        </View>
      ) : null}
      {!loading && example ? (
        <ScrollView
          contentContainerStyle={styles.content}
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
        >
          <View collapsable={false} ref={overviewRef} style={styles.card}>
            <View style={styles.badgeRow}>
              <Text style={styles.badge}>只读示例</Text>
              <Text style={styles.version}>示例版本 {example.exampleVersion}</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {example.title}
            </Text>
            <Text style={styles.secondary}>{example.scenario}</Text>
            <View style={styles.noAudio}>
              <Ionicons color={textColors.secondary} name="volume-mute-outline" size={22} />
              <Text style={styles.noAudioText}>示例不包含原始音频，无法播放</Text>
            </View>
            <Text style={styles.roles}>
              角色：{example.roles.map((role) => role.label).join('、')}
            </Text>
          </View>

          <View collapsable={false} ref={transcriptRef} style={styles.section}>
            <Text style={styles.sectionTitle}>示例转写</Text>
            {example.transcript.map((segment) => (
              <View key={segment.id} style={styles.segment}>
                <View style={styles.segmentHeader}>
                  <Text style={styles.segmentRole}>{segment.roleLabel}</Text>
                  <Text style={styles.segmentMeta}>
                    {formatTime(segment.startMs)}–{formatTime(segment.endMs)} · {segment.emotion}
                  </Text>
                </View>
                <Text style={styles.body}>{segment.text}</Text>
              </View>
            ))}
          </View>

          <View collapsable={false} ref={reportRef} style={styles.section}>
            <Text style={styles.sectionTitle}>分析报告</Text>
            {example.summarySections.map((section) => (
              <View key={section.title} style={styles.reportBlock}>
                <Text style={styles.reportTitle}>{section.title}</Text>
                <Text style={styles.body}>{section.body}</Text>
              </View>
            ))}
            <Text style={styles.subheading}>分析标签与证据</Text>
            {example.analysisTags.map((tag) => (
              <View key={tag.title} style={styles.tagCard}>
                <Text style={styles.reportTitle}>{tag.title}</Text>
                <Text style={styles.body}>{tag.detail}</Text>
                <Text style={styles.evidence}>证据：{tag.evidenceSegmentIds.join('、')}</Text>
              </View>
            ))}
            <Text style={styles.subheading}>改进建议</Text>
            {example.recommendations.map((item) => (
              <Text key={item} style={styles.listItem}>
                • {item}
              </Text>
            ))}
            <Text style={styles.subheading}>限制说明</Text>
            {example.limitations.map((item) => (
              <Text key={item} style={styles.secondary}>
                • {item}
              </Text>
            ))}
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  loader: { marginTop: spacing.xxl },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: 120 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  stateCard: {
    backgroundColor: colors.card,
    gap: spacing.md,
    margin: spacing.md,
    padding: spacing.md,
  },
  badgeRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  badge: {
    ...typography.label,
    backgroundColor: colors.successSurface,
    borderRadius: radii.default,
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
  secondary: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  body: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  noAudio: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noAudioText: { ...typography.description, color: textColors.secondary, flex: 1 },
  roles: { ...typography.description, color: textColors.primary },
  section: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  segment: {
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  segmentHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  segmentRole: { ...typography.heading3, color: textColors.primary, fontWeight: 'bold' },
  segmentMeta: { ...typography.label, color: textColors.tertiary },
  reportBlock: { gap: spacing.xs },
  reportTitle: { ...typography.heading3, color: textColors.primary, fontWeight: 'bold' },
  subheading: {
    ...typography.heading3,
    color: textColors.primary,
    fontWeight: 'bold',
    marginTop: spacing.sm,
  },
  tagCard: {
    backgroundColor: colors.background,
    borderLeftColor: colors.success,
    borderLeftWidth: 3,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  evidence: { ...typography.label, color: textColors.secondary },
  listItem: { ...typography.body, color: textColors.primary, paddingLeft: spacing.xs },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryText: { ...typography.description, color: colors.white, fontWeight: 'bold' },
});
