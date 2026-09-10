/**
 * 分组资源关联选择抽屉。
 *
 * 为分组主页面提供知识库和数据源的统一多选界面，不负责加载或保存远端数据。
 *
 * Responsibilities:
 * - 展示可关联资源、选择状态、加载状态和错误重试入口。
 * - 将关闭、切换和确认动作交给分组工作区协调。
 *
 * Notes:
 * - 资源列表和关联提交由 GroupScreen 持有，避免组件形成第二份服务端状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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

export type GroupResourceLinkKind = 'knowledge' | 'sources';

export type GroupResourceLinkOption = {
  id: string;
  name: string;
  description: string;
};

/** 展示分组资源关联选择器并转发所有编辑动作。 */
export function GroupResourceLinkSheet({
  error,
  kind,
  loading,
  onClose,
  onConfirm,
  onRetry,
  onToggle,
  options,
  pending,
  selectedIds,
  visible,
}: {
  error: string;
  kind: GroupResourceLinkKind;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  onToggle: (id: string) => void;
  options: GroupResourceLinkOption[];
  pending: boolean;
  selectedIds: Set<string>;
  visible: boolean;
}) {
  const { t } = useAppLanguage();
  const title =
    kind === 'knowledge' ? t('groupSettings.linkKnowledge') : t('groupSettings.linkSources');

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View accessibilityViewIsModal style={styles.overlay}>
        <Pressable
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Pressable
              accessibilityLabel={t('common.close')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={styles.iconButton}
            >
              <Ionicons color={colors.ink} name="close" size={26} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.options}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <ActivityIndicator
                accessibilityLabel={t('groups.loadingLinkOptions')}
                color={colors.ink}
              />
            ) : null}
            {error ? (
              <Pressable
                accessibilityLabel={t('common.retry')}
                accessibilityRole="button"
                onPress={onRetry}
                style={styles.feedback}
              >
                <Text accessibilityRole="alert" style={styles.feedbackText}>
                  {error}
                </Text>
                <Text style={styles.retryText}>{t('groupSettings.reload')}</Text>
              </Pressable>
            ) : null}
            {!loading && !error && options.length === 0 ? (
              <Text style={styles.emptyText}>
                {kind === 'knowledge' ? t('groups.noKnowledgeToLink') : t('groups.noSourcesToLink')}
              </Text>
            ) : null}
            {options.map((option) => {
              const selected = selectedIds.has(option.id);
              return (
                <Pressable
                  accessibilityLabel={`${title}：${option.name}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled: pending }}
                  disabled={pending}
                  key={option.id}
                  onPress={() => onToggle(option.id)}
                  style={({ pressed }) => [
                    styles.option,
                    selected && styles.selectedOption,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.optionCopy}>
                    <Text numberOfLines={1} style={styles.optionTitle}>
                      {option.name}
                    </Text>
                    <Text numberOfLines={2} style={styles.optionDescription}>
                      {option.description}
                    </Text>
                  </View>
                  <Ionicons
                    color={selected ? colors.ink : colors.secondary}
                    name={selected ? 'checkbox' : 'square-outline'}
                    size={24}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onClose}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={t('groupSettings.saveLinks')}
              accessibilityRole="button"
              disabled={selectedIds.size === 0 || pending}
              onPress={onConfirm}
              style={[styles.primaryButton, (selectedIds.size === 0 || pending) && styles.disabled]}
            >
              {pending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>{t('groupSettings.saveLinks')}</Text>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(16, 24, 40, 0.28)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    maxHeight: '78%',
    minHeight: 360,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  title: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  iconButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  options: { gap: spacing.sm, padding: spacing.md },
  option: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 72,
    padding: spacing.base,
  },
  selectedOption: { borderColor: colors.ink, borderWidth: 2 },
  optionCopy: { flex: 1, gap: spacing.xs },
  optionTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  optionDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  feedback: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  feedbackText: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  retryText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  emptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    padding: spacing.lg,
    textAlign: 'center',
  },
  actions: {
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryButtonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: colors.background },
});
