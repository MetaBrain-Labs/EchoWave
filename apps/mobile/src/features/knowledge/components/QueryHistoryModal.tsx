/**
 * 知识问答只读历史面板。
 *
 * 以跨平台 Modal 展示当前知识库最近六个已完成问答，不提供编辑、删除或续聊操作。
 *
 * Responsibilities:
 * - 展示历史加载、空白、错误和成功状态。
 * - 提供关闭与加载失败重试入口。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { RagHistoryItem } from '@echowave/contracts';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamilies, radii, spacing, textColors, typography } from '@/shared/theme/tokens';

function historyTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 渲染最近问答的只读弹层。 */
export function QueryHistoryModal({
  error,
  items,
  loading,
  onClose,
  onRetry,
  visible,
}: {
  error: string;
  items: RagHistoryItem[];
  loading: boolean;
  onClose: () => void;
  onRetry: () => void;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View accessibilityViewIsModal style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>最近问答</Text>
              <Text style={styles.subtitle}>仅展示最近 6 个已完成问答</Text>
            </View>
            <Pressable accessibilityLabel="关闭历史记录" accessibilityRole="button" hitSlop={8} onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
              <Ionicons color={colors.ink} name="close" size={26} />
            </Pressable>
          </View>
          {loading ? (
            <View style={styles.state}>
              <ActivityIndicator accessibilityLabel="正在加载历史记录" color={colors.ink} />
              <Text style={styles.stateText}>正在读取最近问答…</Text>
            </View>
          ) : error ? (
            <View style={styles.state}>
              <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
                <Text style={styles.retryText}>重新加载</Text>
              </Pressable>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.state}>
              <Ionicons color={colors.muted} name="chatbubble-ellipses-outline" size={32} />
              <Text style={styles.stateText}>还没有已完成的问答记录</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {items.map((item) => (
                <View key={item.id} style={styles.item}>
                  <Text style={styles.time}>{historyTime(item.createdAt)}</Text>
                  <Text style={styles.role}>你</Text>
                  <Text selectable style={styles.question}>{item.question}</Text>
                  <Text style={styles.role}>Assistant</Text>
                  <Text selectable style={styles.answer}>{item.answer}</Text>
                  <Text style={styles.meta}>{item.citationCount > 0 ? `${item.citationCount} 条引用来源` : '无引用来源'}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: 'rgba(16, 24, 40, 0.28)', flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: spacing.lg, borderTopRightRadius: spacing.lg, maxHeight: '82%', minHeight: '45%', paddingBottom: spacing.xl },
  header: { alignItems: 'center', borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  title: { ...typography.heading1, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  subtitle: { ...typography.label, color: textColors.tertiary, fontFamily: fontFamilies.sans, marginTop: spacing.xs },
  close: { alignItems: 'center', borderRadius: radii.round, height: 44, justifyContent: 'center', width: 44 },
  pressed: { backgroundColor: colors.background },
  state: { alignItems: 'center', flex: 1, gap: spacing.md, justifyContent: 'center', minHeight: 220, padding: spacing.xl },
  stateText: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans, textAlign: 'center' },
  error: { ...typography.body, color: '#b42318', fontFamily: fontFamilies.sans, textAlign: 'center' },
  retryButton: { backgroundColor: colors.ink, borderRadius: radii.default, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  retryText: { ...typography.description, color: colors.card, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  list: { gap: spacing.md, padding: spacing.md },
  item: { borderColor: colors.divider, borderRadius: radii.default, borderWidth: StyleSheet.hairlineWidth, gap: spacing.xs, padding: spacing.md },
  time: { ...typography.label, color: textColors.tertiary, fontFamily: fontFamilies.sans },
  role: { ...typography.label, color: colors.success, fontFamily: fontFamilies.sansBold, fontWeight: 'bold', marginTop: spacing.xs },
  question: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  answer: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  meta: { ...typography.label, color: textColors.tertiary, fontFamily: fontFamilies.sans, marginTop: spacing.xs },
});
