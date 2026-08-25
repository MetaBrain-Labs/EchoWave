/**
 * 数据源编辑与关系操作弹层。
 *
 * 提供符合设计规范的创建/编辑抽屉、活动分组多选器和破坏性操作确认弹窗。
 *
 * Responsibilities:
 * - 保持表单草稿、禁用配置与提交反馈可访问。
 * - 将确认结果交给数据源页面执行，不直接访问网络或路由。
 *
 * Notes:
 * - 分析与接入配置只读，不进入创建或更新请求。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type {
  AudioTranscriptionModel,
  AudioTranscriptionModelCapability,
  GroupSummary,
} from '@echowave/contracts';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

export type DataSourceFormValue = { name: string; description: string };
type DataSourceFormSheetProps = {
  error: string;
  initialValue: DataSourceFormValue;
  mode: 'create' | 'edit';
  onClose: () => void;
  onSubmit: (value: DataSourceFormValue) => void;
  pending: boolean;
  transcriptionModel?: string;
  visible: boolean;
};

function ReadonlyItem({ label, value }: { label: string; value: string }) {
  return (
    <View accessibilityState={{ disabled: true }} style={styles.readonlyItem}>
      <Text style={styles.readonlyLabel}>{label}</Text>
      <Text style={styles.readonlyValue}>{value}</Text>
    </View>
  );
}

function DataSourceFormSheetContent({
  error,
  initialValue,
  mode,
  onClose,
  onSubmit,
  pending,
  transcriptionModel,
  visible,
}: DataSourceFormSheetProps) {
  const [name, setName] = useState(initialValue.name);
  const [description, setDescription] = useState(initialValue.description);

  const trimmedName = name.trim();
  const submit = () => {
    if (!pending && trimmedName) onSubmit({ name: trimmedName, description: description.trim() });
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="关闭数据源表单"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {mode === 'create' ? '新增数据源' : '编辑数据源'}
            </Text>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              disabled={pending}
              onPress={onClose}
              style={styles.iconButton}
            >
              <Ionicons color={colors.ink} name="close" size={24} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.fieldLabel}>数据源名称</Text>
            <TextInput
              accessibilityLabel="数据源名称"
              autoFocus
              maxLength={120}
              onChangeText={setName}
              onSubmitEditing={submit}
              placeholder="请输入数据源名称"
              placeholderTextColor={textColors.tertiary}
              returnKeyType="done"
              style={styles.nameInput}
              textAlignVertical="center"
              value={name}
            />
            <Text style={styles.fieldLabel}>描述</Text>
            <TextInput
              accessibilityLabel="数据源描述"
              maxLength={1_000}
              multiline
              onChangeText={setDescription}
              placeholder="请输入数据源描述（可选）"
              placeholderTextColor={textColors.tertiary}
              style={styles.descriptionInput}
              textAlignVertical="top"
              value={description}
            />

            <Text style={styles.sectionTitle}>音频接入</Text>
            <ReadonlyItem label="接入方式" value="手动上传" />
            <ReadonlyItem label="存储位置" value="本地" />
            <Text style={styles.sectionTitle}>音频分析</Text>
            <ReadonlyItem label="转写模型" value={transcriptionModel ?? '由服务端配置'} />
            <ReadonlyItem label="分析设置" value="默认开启" />
            {error ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {error}
              </Text>
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pending || !trimmedName }}
            disabled={pending || !trimmedName}
            onPress={submit}
            style={({ pressed }) => [
              styles.primaryButton,
              (pending || !trimmedName) && styles.disabledButton,
              pressed && styles.pressed,
            ]}
          >
            {pending ? <ActivityIndicator color={colors.white} /> : null}
            <Text style={styles.primaryButtonText}>{pending ? '正在保存…' : '确认'}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** 创建或编辑数据源名称与描述，配置区始终只读。 */
export function DataSourceFormSheet(props: DataSourceFormSheetProps) {
  if (!props.visible) return null;
  return <DataSourceFormSheetContent {...props} />;
}

/** 从全部活动分组中选择尚未关联的目标。 */
export function DataSourceGroupPicker({
  allGroups,
  error,
  linkedGroupIds,
  loading,
  onClose,
  onConfirm,
  onRetry,
  onToggle,
  pending,
  selectedGroupIds,
  visible,
}: {
  allGroups: GroupSummary[];
  error: string;
  linkedGroupIds: Set<string>;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  onToggle: (groupId: string) => void;
  pending: boolean;
  selectedGroupIds: Set<string>;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="关闭分组选择"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              关联新分组
            </Text>
            <Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.iconButton}>
              <Ionicons color={colors.ink} name="close" size={24} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.groupOptions}>
            {loading ? (
              <ActivityIndicator accessibilityLabel="正在加载可关联分组" color={colors.ink} />
            ) : null}
            {error ? (
              <View style={styles.feedbackBox}>
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {error}
                </Text>
                <Pressable accessibilityRole="button" onPress={onRetry}>
                  <Text style={styles.retryText}>重新加载</Text>
                </Pressable>
              </View>
            ) : null}
            {!loading && !error && allGroups.length === 0 ? (
              <Text style={styles.secondaryText}>暂无可用分组。</Text>
            ) : null}
            {allGroups.map((group) => {
              const linked = linkedGroupIds.has(group.id);
              const selected = selectedGroupIds.has(group.id);
              return (
                <Pressable
                  accessibilityLabel={`${linked ? '已关联' : selected ? '取消选择' : '选择'}分组：${group.name}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: linked || selected, disabled: linked }}
                  disabled={linked || pending}
                  key={group.id}
                  onPress={() => onToggle(group.id)}
                  style={({ pressed }) => [
                    styles.groupOption,
                    linked && styles.linkedOption,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.groupOptionMain}>
                    <Text style={styles.groupOptionTitle}>{group.name}</Text>
                    <Text style={styles.secondaryText}>
                      {group.metrics.audioCount} 条音频 · {group.metrics.sourceCount} 个数据源
                    </Text>
                  </View>
                  <Ionicons
                    color={linked || selected ? colors.ink : colors.secondary}
                    name={linked || selected ? 'checkbox' : 'square-outline'}
                    size={24}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pending || selectedGroupIds.size === 0 }}
            disabled={pending || selectedGroupIds.size === 0}
            onPress={onConfirm}
            style={({ pressed }) => [
              styles.primaryButton,
              (pending || selectedGroupIds.size === 0) && styles.disabledButton,
              pressed && styles.pressed,
            ]}
          >
            {pending ? <ActivityIndicator color={colors.white} /> : null}
            <Text style={styles.primaryButtonText}>{pending ? '正在关联…' : '确认关联'}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** 对归档、解除关联等操作提供统一二次确认。 */
export function DataSourceConfirmDialog({
  body,
  confirmLabel,
  onCancel,
  onConfirm,
  pending = false,
  title,
  visible,
}: {
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  title: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.dialogRoot}>
        <View accessibilityViewIsModal style={styles.dialogCard}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {title}
          </Text>
          <Text style={styles.dialogBody}>{body}</Text>
          <View style={styles.dialogActions}>
            <Pressable disabled={pending} onPress={onCancel} style={styles.dialogButton}>
              <Text style={styles.dialogButtonText}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onConfirm}
              style={[styles.dialogButton, styles.dialogConfirmButton]}
            >
              <Text style={styles.dialogConfirmText}>{pending ? '处理中…' : confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** 确认单次 ASR，并在服务端能力范围内选择 FFmpeg 或原文件直传。 */
export function AudioTranscriptionConfirmDialog({
  audioTitle,
  ffmpegAvailable,
  ffmpegChecked,
  models,
  onCancel,
  onConfirm,
  onToggleFfmpeg,
  onSelectModel,
  pending,
  visible,
  selectedModel,
}: {
  audioTitle: string;
  ffmpegAvailable: boolean;
  ffmpegChecked: boolean;
  models: AudioTranscriptionModelCapability[];
  onCancel: () => void;
  onConfirm: () => void;
  onToggleFfmpeg: () => void;
  onSelectModel: (model: AudioTranscriptionModel) => void;
  pending: boolean;
  visible: boolean;
  selectedModel: AudioTranscriptionModel;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.dialogRoot}>
        <View accessibilityViewIsModal style={styles.dialogCard}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            开始 ASR 转写？
          </Text>
          <Text style={styles.dialogBody}>
            将使用所选 STT 模型转写“{audioTitle}”。Speaker
            与时间戳精度取决于模型实际返回；业务角色和情绪将标记为未知。
          </Text>
          <Text style={styles.transcriptionSectionTitle}>转写模型</Text>
          {models.length === 0 ? (
            <Text accessibilityRole="alert" style={styles.directWarning}>
              转写模型目录加载失败，请关闭后重试。
            </Text>
          ) : null}
          <ScrollView style={styles.transcriptionModelList}>
            {models.map((model) => {
              const selected = model.id === selectedModel;
              return (
                <Pressable
                  accessibilityLabel={`${model.displayName}，${model.description}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: pending }}
                  disabled={pending}
                  key={model.id}
                  onPress={() => onSelectModel(model.id)}
                  style={[styles.transcriptionModelOption, selected && styles.selectedModelOption]}
                >
                  <Ionicons
                    color={selected ? colors.ink : textColors.tertiary}
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                  />
                  <View style={styles.transcriptionOptionCopy}>
                    <Text style={styles.transcriptionOptionTitle}>{model.displayName}</Text>
                    <Text style={styles.secondaryText}>{model.description}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            accessibilityLabel="使用 FFmpeg 预处理"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ffmpegChecked, disabled: !ffmpegAvailable || pending }}
            disabled={!ffmpegAvailable || pending}
            onPress={onToggleFfmpeg}
            style={[styles.transcriptionOption, !ffmpegAvailable && styles.disabledButton]}
          >
            <Ionicons
              color={ffmpegAvailable ? textColors.primary : textColors.tertiary}
              name={ffmpegChecked ? 'checkbox' : 'square-outline'}
              size={24}
            />
            <View style={styles.transcriptionOptionCopy}>
              <Text style={styles.transcriptionOptionTitle}>使用 FFmpeg 预处理</Text>
              <Text style={styles.secondaryText}>
                {ffmpegAvailable
                  ? '转为统一 MP3 并对长音频分块，提高兼容性。'
                  : 'FFmpeg 未配置或不可用，将直接发送原音频。'}
              </Text>
            </View>
          </Pressable>
          {!ffmpegChecked ? (
            <Text accessibilityRole="alert" style={styles.directWarning}>
              原音频将以 base64 直接发送；大文件可能被转写服务拒绝，失败后可勾选 FFmpeg 重新转写。
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <Pressable disabled={pending} onPress={onCancel} style={styles.dialogButton}>
              <Text style={styles.dialogButtonText}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pending || models.length === 0 }}
              disabled={pending || models.length === 0}
              onPress={onConfirm}
              style={[styles.dialogButton, styles.dialogConfirmButton]}
            >
              <Text style={styles.dialogConfirmText}>{pending ? '处理中…' : '确认转写'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(16, 24, 40, 0.28)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    maxHeight: '88%',
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  sheetTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  sheetContent: { paddingBottom: spacing.lg, paddingHorizontal: spacing.md },
  fieldLabel: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  nameInput: {
    ...typography.body,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    height: 44,
    includeFontPadding: false,
    paddingHorizontal: spacing.base,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  descriptionInput: {
    ...typography.body,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    minHeight: 88,
    padding: spacing.base,
  },
  sectionTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginTop: spacing.lg,
  },
  readonlyItem: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.base,
  },
  readonlyLabel: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  readonlyValue: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.black,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    margin: spacing.md,
    minHeight: 48,
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  disabledButton: { opacity: 0.45 },
  errorText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  groupOptions: { gap: spacing.sm, padding: spacing.md },
  groupOption: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flexDirection: 'row',
    minHeight: 68,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.base,
  },
  linkedOption: { opacity: 0.5 },
  groupOptionMain: { flex: 1, gap: spacing.xs },
  groupOptionTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  secondaryText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  feedbackBox: { gap: spacing.sm },
  retryText: {
    ...typography.heading5,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  dialogRoot: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.28)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  dialogCard: {
    backgroundColor: colors.white,
    borderRadius: radii.default,
    gap: spacing.md,
    padding: spacing.md,
    width: '100%',
  },
  dialogBody: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  transcriptionSectionTitle: {
    ...typography.label,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  transcriptionModelList: { maxHeight: 260 },
  transcriptionModelOption: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.sm,
  },
  selectedModelOption: { borderColor: colors.ink, backgroundColor: colors.background },
  dialogActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  dialogButton: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    minWidth: 88,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.base,
  },
  dialogConfirmButton: { backgroundColor: colors.black, borderColor: colors.black },
  dialogButtonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    textAlign: 'center',
  },
  dialogConfirmText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    textAlign: 'center',
  },
  transcriptionOption: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.base,
  },
  transcriptionOptionCopy: { flex: 1, gap: spacing.xs },
  transcriptionOptionTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  directWarning: {
    ...typography.description,
    backgroundColor: colors.background,
    borderRadius: radii.default,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    padding: spacing.base,
  },
  pressed: { opacity: 0.72 },
});
