/**
 * 音频转写实时进度弹窗。
 *
 * 将服务端持久化的阶段、分块和尝试次数转换为跨平台可读的执行进度，不接收或展示模型正文。
 *
 * Responsibilities:
 * - 展示当前阶段、总体进度、分块时间范围和重试次数。
 * - 根据当前分块与阶段渲染分块列表和主流程时间线。
 *
 * Notes:
 * - 旧修订可能没有 activity，此时仅展示兼容的总体进度说明。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { AudioTranscriptionStage } from '@echowave/contracts';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

import type { SourceAudioItem } from '../model';

const stageLabels: Record<AudioTranscriptionStage, string> = {
  queued: '排队等待',
  preprocessing: '音频预处理',
  transcribing: '模型转写',
  validating: '校验模型输出',
  correcting: '兼容旧修订阶段',
  splitting: 'Chunk 输出异常，正在细分',
  merging: '校验合并与去重',
  publishing: '发布转写结果',
};

const timeline = [
  { key: 'queued', label: '排队' },
  { key: 'preprocessing', label: '预处理' },
  { key: 'transcribing', label: '分块转写' },
  { key: 'merging', label: '校验合并' },
  { key: 'publishing', label: '发布' },
] as const;

/** 将转写阶段转换为用户可读的中文名称。 */
export function audioTranscriptionStageLabel(stage: AudioTranscriptionStage): string {
  return stageLabels[stage];
}

function timelineIndex(stage: AudioTranscriptionStage): number {
  if (stage === 'validating' || stage === 'correcting' || stage === 'splitting') return 2;
  return timeline.findIndex((item) => item.key === stage);
}

function formatTimestamp(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 展示单条进行中音频修订的安全实时进度。 */
export function AudioTranscriptionProgressDialog({
  audio,
  onClose,
}: {
  audio?: SourceAudioItem;
  onClose: () => void;
}) {
  const status = audio?.status.kind === 'transcribing' ? audio.status : undefined;
  const activity = status?.activity;
  const activeTimelineIndex = activity ? timelineIndex(activity.stage) : -1;
  const chunksComplete = activity?.stage === 'merging' || activity?.stage === 'publishing';
  const chunks = activity?.chunkCount
    ? Array.from({ length: activity.chunkCount }, (_, i) => i + 1)
    : [];

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={Boolean(status)}>
      <View style={styles.root}>
        <View accessibilityViewIsModal style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons color={colors.ink} name="pulse-outline" size={24} />
              <Text accessibilityRole="header" style={styles.title}>
                转写进度
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭转写进度"
              onPress={onClose}
              style={styles.iconButton}
            >
              <Ionicons color={colors.ink} name="close" size={24} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.audioTitle}>{audio?.title}</Text>
            <View style={styles.progressSummary}>
              <View style={styles.summaryRow}>
                <Text style={styles.sectionTitle}>
                  {activity ? audioTranscriptionStageLabel(activity.stage) : '正在转写'}
                </Text>
                <Text style={styles.percent}>{status?.progress ?? 0}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(100, status?.progress ?? 0)}%` },
                  ]}
                />
              </View>
              <Text style={styles.secondaryText}>
                最近更新：
                {activity ? new Date(activity.updatedAt).toLocaleString() : '等待服务端更新'}
              </Text>
            </View>

            {activity ? (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>当前执行</Text>
                  {chunksComplete && activity.chunkCount !== null ? (
                    <Text style={styles.detailText}>
                      全部 {activity.chunkCount} 个 Chunk 已完成。
                    </Text>
                  ) : activity.chunkIndex !== null ? (
                    <Text style={styles.detailText}>
                      Chunk {activity.chunkIndex}/{activity.chunkCount} ·{' '}
                      {formatTimestamp(activity.chunkStartMs ?? 0)}–
                      {formatTimestamp(activity.chunkEndMs ?? 0)}
                    </Text>
                  ) : (
                    <Text style={styles.detailText}>预处理完成后将显示分块范围。</Text>
                  )}
                  {activity.networkAttempt !== null ? (
                    <Text style={styles.detailText}>网络尝试 {activity.networkAttempt}/3</Text>
                  ) : null}
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Chunks</Text>
                  {chunks.length ? (
                    <View style={styles.chunkList}>
                      {chunks.map((chunk) => {
                        const current = activity.chunkIndex ?? 0;
                        const state = chunksComplete
                          ? '已完成'
                          : chunk < current
                            ? '已完成'
                            : chunk === current
                              ? '进行中'
                              : '待处理';
                        return (
                          <View key={chunk} style={styles.chunkRow}>
                            <Ionicons
                              color={
                                chunksComplete || chunk < current
                                  ? colors.success
                                  : colors.secondary
                              }
                              name={
                                chunksComplete || chunk < current
                                  ? 'checkmark-circle'
                                  : chunk === current
                                    ? 'radio-button-on'
                                    : 'ellipse-outline'
                              }
                              size={18}
                            />
                            <Text style={styles.chunkText}>Chunk {chunk}</Text>
                            <Text style={styles.chunkState}>{state}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={styles.detailText}>当前尚未生成分块。</Text>
                  )}
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>执行阶段</Text>
                  {timeline.map((item, index) => {
                    const state =
                      index < activeTimelineIndex
                        ? '已完成'
                        : index === activeTimelineIndex
                          ? '进行中'
                          : '待处理';
                    return (
                      <View key={item.key} style={styles.timelineRow}>
                        <View
                          style={[
                            styles.timelineDot,
                            index <= activeTimelineIndex && styles.timelineDotActive,
                          ]}
                        />
                        <Text style={styles.timelineLabel}>{item.label}</Text>
                        <Text style={styles.chunkState}>{state}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            ) : (
              <Text style={styles.fallback}>服务端尚未提供阶段明细，页面会继续每 2 秒刷新。</Text>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}>
              <Text style={styles.buttonText}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.28)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.default,
    maxHeight: '86%',
    overflow: 'hidden',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: spacing.md,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  title: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  iconButton: { alignItems: 'center', height: 52, justifyContent: 'center', width: 52 },
  content: { gap: spacing.md, padding: spacing.md },
  audioTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  progressSummary: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.base,
  },
  summaryRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  section: { gap: spacing.sm },
  sectionTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  percent: { ...typography.heading3, color: textColors.primary, fontFamily: fontFamilies.sansBold },
  progressTrack: {
    backgroundColor: colors.divider,
    borderRadius: radii.round,
    height: 6,
    overflow: 'hidden',
  },
  progressFill: { backgroundColor: colors.ink, borderRadius: radii.round, height: '100%' },
  secondaryText: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  detailText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  chunkList: { borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1 },
  chunkRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.base,
  },
  chunkText: {
    ...typography.description,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
  },
  chunkState: { ...typography.label, color: textColors.secondary, fontFamily: fontFamilies.sans },
  timelineRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 34 },
  timelineDot: {
    backgroundColor: colors.divider,
    borderRadius: radii.round,
    height: 10,
    width: 10,
  },
  timelineDotActive: { backgroundColor: colors.ink },
  timelineLabel: {
    ...typography.description,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sans,
  },
  fallback: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  actions: {
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  button: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    minWidth: 96,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.base,
  },
  buttonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    textAlign: 'center',
  },
});
