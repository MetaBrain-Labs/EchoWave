/**
 * 音频转写失败详情弹窗。
 *
 * 将服务端返回的安全结构化诊断转换为中文说明，并提供关闭与重新转写入口。
 *
 * Responsibilities:
 * - 展示稳定错误码、失败阶段、分块位置、纠正次数和校验问题。
 * - 在不暴露模型正文、报告路径或服务端内部状态的前提下给出操作建议。
 *
 * Notes:
 * - 模型原始输出只允许存在于服务端本地执行报告，不能通过此组件接收或展示。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
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

const categoryLabels = {
  invalid_json: '模型输出不是有效 JSON',
  schema_validation: '模型输出字段不符合约定',
  semantic_validation: '模型输出内容未通过语义校验',
  provider: '模型服务调用失败',
  timeout: '模型服务请求超时',
  preprocessing: '音频预处理失败',
  internal: '内部处理失败',
} as const;

/** 根据稳定诊断信息提供不包含内部实现细节的重试建议。 */
function retrySuggestion(audio: SourceAudioItem): string {
  if (audio.status.kind !== 'transcription-failed') return '';
  if (!audio.status.retryable) {
    return '该错误当前不可直接重试，请先检查音频格式、服务配置或账户权限。';
  }
  if (audio.status.details?.category === 'preprocessing') {
    return '请检查服务端 FFmpeg 配置后重新发起整文件转写。';
  }
  return '可以重新发起 DashScope 整文件转写；若仍失败，请检查账户权限、OSS 与音频内容。';
}

/** 展示单条音频最近一次转写修订的安全失败诊断。 */
export function AudioTranscriptionErrorDialog({
  audio,
  onClose,
  onRetry,
}: {
  audio?: SourceAudioItem;
  onClose: () => void;
  onRetry: () => void;
}) {
  const status = audio?.status.kind === 'transcription-failed' ? audio.status : undefined;
  const details = status?.details;
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={Boolean(status)}>
      <View style={styles.root}>
        <View accessibilityViewIsModal style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons color={colors.ink} name="alert-circle-outline" size={24} />
              <Text accessibilityRole="header" style={styles.title}>
                音频转写失败
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭错误详情"
              onPress={onClose}
              style={styles.iconButton}
            >
              <Ionicons color={colors.ink} name="close" size={24} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.audioTitle}>{audio?.title}</Text>
            <View style={styles.summaryBox}>
              <Text style={styles.label}>错误码</Text>
              <Text selectable style={styles.code}>
                {status?.code}
              </Text>
              <Text style={styles.message}>{status?.message}</Text>
            </View>

            {details ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>失败诊断</Text>
                <Text style={styles.detailText}>类型：{categoryLabels[details.category]}</Text>
                <Text style={styles.detailText}>阶段：ASR 转写</Text>
                {details.chunkIndex !== null ? (
                  <Text style={styles.detailText}>
                    分块：{details.chunkIndex}
                    {details.chunkCount !== null ? ` / ${details.chunkCount}` : ''}
                  </Text>
                ) : null}
                {details.structureAttempts > 0 ? (
                  <Text style={styles.detailText}>结构纠正次数：{details.structureAttempts}</Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.fallback}>
                此失败记录没有更详细的结构化诊断，请根据错误码检查配置后重试。
              </Text>
            )}

            {details?.issues.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>校验问题</Text>
                {details.issues.map((issue, index) => (
                  <View key={`${issue.path}-${issue.code}-${index}`} style={styles.issue}>
                    <Text style={styles.issueTitle}>
                      {index + 1}. {issue.code}
                    </Text>
                    <Text style={styles.issuePath}>字段：{issue.path || '$'}</Text>
                    <Text style={styles.detailText}>{issue.message}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.suggestionBox}>
              <Text style={styles.sectionTitle}>
                {status?.retryable ? '可以重试' : '暂不可直接重试'}
              </Text>
              <Text style={styles.detailText}>{audio ? retrySuggestion(audio) : ''}</Text>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}>
              <Text style={styles.buttonText}>关闭</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              style={[styles.button, styles.primaryButton]}
              testID="transcription-error-retry"
            >
              <Text style={styles.primaryButtonText}>重新转写</Text>
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
  summaryBox: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    padding: spacing.base,
  },
  label: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  code: {
    ...typography.heading5,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    marginTop: spacing.xs,
  },
  message: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
  section: { gap: spacing.sm },
  sectionTitle: {
    ...typography.heading5,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  detailText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  fallback: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  issue: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.base,
  },
  issueTitle: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  issuePath: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  suggestionBox: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.xs,
    padding: spacing.base,
  },
  actions: {
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
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
  primaryButton: { backgroundColor: colors.black, borderColor: colors.black },
  buttonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    textAlign: 'center',
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    textAlign: 'center',
  },
});
