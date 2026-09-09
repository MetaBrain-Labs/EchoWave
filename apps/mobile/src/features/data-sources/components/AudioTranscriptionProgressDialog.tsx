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
import { translateAppText, useAppLanguage } from '@/shared/i18n/LanguageProvider';

import type { SourceAudioItem } from '../model';

const timeline = ['queued', 'preprocessing', 'transcribing', 'merging', 'publishing'] as const;

/** 将转写阶段转换为当前应用语言的名称。 */
export function audioTranscriptionStageLabel(
  stage: AudioTranscriptionStage,
  t: ReturnType<typeof useAppLanguage>['t'] = translateAppText,
): string {
  const keys = {
    queued: 'asrStage.queued',
    preprocessing: 'asrStage.preprocessing',
    transcribing: 'asrStage.transcribing',
    awaiting_result: 'asrStage.awaiting',
    validating: 'asrStage.validating',
    correcting: 'asrStage.correcting',
    splitting: 'asrStage.splitting',
    merging: 'asrStage.merging',
    publishing: 'asrStage.publishing',
  } as const;
  return t(keys[stage]);
}

function timelineIndex(stage: AudioTranscriptionStage): number {
  if (
    stage === 'awaiting_result' ||
    stage === 'validating' ||
    stage === 'correcting' ||
    stage === 'splitting'
  )
    return 2;
  return timeline.findIndex((item) => item === stage);
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
  const { formatDateTime, formatNumber, t } = useAppLanguage();
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
                {t('asrProgress.title')}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={t('asrProgress.closeAccessibility')}
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
                  {activity
                    ? audioTranscriptionStageLabel(activity.stage, t)
                    : t('audioRow.transcribing')}
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
                {t('asrProgress.updated', {
                  date: activity
                    ? formatDateTime(activity.updatedAt)
                    : t('asrProgress.waitingUpdate'),
                })}
              </Text>
            </View>

            {activity ? (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{t('asrProgress.current')}</Text>
                  {chunksComplete && activity.chunkCount !== null ? (
                    <Text style={styles.detailText}>
                      {t('asrProgress.allChunks', {
                        count: formatNumber(activity.chunkCount),
                      })}
                    </Text>
                  ) : activity.chunkIndex !== null ? (
                    <Text style={styles.detailText}>
                      Chunk {activity.chunkIndex}/{activity.chunkCount} ·{' '}
                      {formatTimestamp(activity.chunkStartMs ?? 0)}–
                      {formatTimestamp(activity.chunkEndMs ?? 0)}
                    </Text>
                  ) : (
                    <Text style={styles.detailText}>{t('asrProgress.afterPreprocess')}</Text>
                  )}
                  {activity.networkAttempt !== null ? (
                    <Text style={styles.detailText}>
                      {t('asrProgress.networkAttempt', {
                        attempt: formatNumber(activity.networkAttempt),
                      })}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Chunks</Text>
                  {chunks.length ? (
                    <View style={styles.chunkList}>
                      {chunks.map((chunk) => {
                        const current = activity.chunkIndex ?? 0;
                        const state = chunksComplete
                          ? t('asrProgress.complete')
                          : chunk < current
                            ? t('asrProgress.complete')
                            : chunk === current
                              ? t('asrProgress.running')
                              : t('asrProgress.pending');
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
                    <Text style={styles.detailText}>{t('asrProgress.noChunks')}</Text>
                  )}
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{t('asrProgress.stages')}</Text>
                  {timeline.map((item, index) => {
                    const state =
                      index < activeTimelineIndex
                        ? t('asrProgress.complete')
                        : index === activeTimelineIndex
                          ? t('asrProgress.running')
                          : t('asrProgress.pending');
                    return (
                      <View key={item} style={styles.timelineRow}>
                        <View
                          style={[
                            styles.timelineDot,
                            index <= activeTimelineIndex && styles.timelineDotActive,
                          ]}
                        />
                        <Text style={styles.timelineLabel}>
                          {audioTranscriptionStageLabel(item, t)}
                        </Text>
                        <Text style={styles.chunkState}>{state}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            ) : (
              <Text style={styles.fallback}>{t('asrProgress.fallback')}</Text>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}>
              <Text style={styles.buttonText}>{t('common.close')}</Text>
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
