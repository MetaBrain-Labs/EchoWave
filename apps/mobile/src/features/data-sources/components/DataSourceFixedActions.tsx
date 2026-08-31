/**
 * 数据源固定操作栏。
 *
 * 根据当前分页展示上传、转写、重试和关联入口。
 *
 * Responsibilities:
 * - 保持固定操作区的禁用状态和建设中反馈
 *
 * Notes:
 * - 仅渲染 feature 数据并通过回调上报操作，不访问网络或路由。
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

type DetailTab = 'overview' | 'audio' | 'uploads' | 'groups';

export function showComingSoon(feature: string) {
  Alert.alert('功能建设中', `${feature}将在后续版本开放。`);
}

function ActionButton({
  icon,
  label,
  onPress,
  emphasized = false,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  emphasized?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        emphasized && styles.emphasizedActionButton,
        disabled && styles.disabledActionButton,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={colors.ink} name={icon} size={typography.body.lineHeight} />
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

export function FixedActions({
  activeTab,
  onLinkGroups,
  onUpload,
  uploading,
}: {
  activeTab: DetailTab;
  onLinkGroups: () => void;
  onUpload: () => void;
  uploading: boolean;
}) {
  if (activeTab === 'groups') {
    return (
      <View style={styles.fixedActions} testID="data-source-fixed-actions">
        <ActionButton emphasized icon="add" label="关联新分组" onPress={onLinkGroups} />
      </View>
    );
  }
  if (activeTab === 'uploads') {
    return (
      <View style={styles.fixedActions} testID="data-source-fixed-actions">
        <ActionButton
          emphasized
          icon="cloud-upload-outline"
          label={uploading ? '正在上传…' : '上传音频'}
          onPress={onUpload}
          disabled={uploading}
        />
      </View>
    );
  }
  return (
    <View style={styles.fixedActions} testID="data-source-fixed-actions">
      <ActionButton
        icon="create-outline"
        label="全部转写"
        onPress={() => showComingSoon('全部转写')}
      />
      <ActionButton
        emphasized
        icon="cloud-upload-outline"
        label={uploading ? '正在上传…' : '上传音频'}
        onPress={onUpload}
        disabled={uploading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  emphasizedActionButton: { borderColor: colors.ink, borderWidth: 2 },
  disabledActionButton: { opacity: 0.5 },
  pressed: { backgroundColor: colors.divider, borderRadius: radii.default },
  actionButtonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  fixedActions: {
    backgroundColor: colors.card,
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
});
