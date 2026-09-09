/**
 * ASR 结果分析分组选择器。
 *
 * 当一个数据源关联多个分组时，要求用户显式选择分析设置与知识库权限来源。
 *
 * Responsibilities:
 * - 展示可用于当前音频分析的分组列表。
 * - 将选择结果返回数据源详情编排器。
 *
 * Notes:
 * - 不自行启动分析或保存关联。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { LinkedDataSourceGroup } from '@echowave/contracts';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

/** 选择本次业务分析使用的分组上下文。 */
export function AnalysisGroupPicker({
  groups,
  onClose,
  onSelect,
  visible,
}: {
  groups: LinkedDataSourceGroup[];
  onClose: () => void;
  onSelect: (groupId: string) => void;
  visible: boolean;
}) {
  const { formatNumber, t } = useAppLanguage();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable
        accessibilityLabel={t('analysisGroup.close')}
        onPress={onClose}
        style={styles.backdrop}
      />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.header}>
          <View>
            <Text accessibilityRole="header" style={styles.title}>
              {t('analysisGroup.title')}
            </Text>
            <Text style={styles.description}>{t('analysisGroup.description')}</Text>
          </View>
          <Pressable accessibilityLabel={t('common.close')} onPress={onClose} style={styles.close}>
            <Ionicons color={colors.ink} name="close" size={24} />
          </Pressable>
        </View>
        {groups.map((group) => (
          <Pressable
            accessibilityRole="button"
            key={group.id}
            onPress={() => onSelect(group.id)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.copy}>
              <Text style={styles.rowTitle}>{group.name}</Text>
              <Text style={styles.meta}>
                {t('analysisGroup.counts', {
                  knowledge: formatNumber(group.knowledgeCount),
                  audio: formatNumber(group.audioCount),
                })}
              </Text>
            </View>
            <Ionicons color={colors.secondary} name="chevron-forward" size={20} />
          </Pressable>
        ))}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(16, 24, 40, 0.28)', flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    padding: spacing.md,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  close: { alignItems: 'center', justifyContent: 'center', minHeight: 40, width: 40 },
  row: {
    alignItems: 'center',
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 64,
  },
  copy: { flex: 1 },
  rowTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  meta: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  pressed: { backgroundColor: colors.background },
});
