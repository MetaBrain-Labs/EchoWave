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
import {
  CORE_BUSINESS_ROLES,
  type AudioTranscriptionModelCapability,
  type AudioTranscriptionPreprocessing,
  type AudioTranscriptionCapabilitiesResponse,
  type GroupSummary,
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

export type DataSourceFormValue = {
  name: string;
  description: string;
  customBusinessRoles?: string[];
};
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

const priceUnitLabels = {
  million_tokens: '百万 tokens',
  minute: '分钟',
  second: '秒',
  included: '已包含',
} as const;

function formatModelPrice(price: AudioTranscriptionModelCapability['pricing']['input']): string {
  if (price.unit === 'included') return '已包含';
  const symbol = price.currency === 'CNY' ? '¥' : '$';
  return `${symbol}${price.amount}/${priceUnitLabels[price.unit]}`;
}

function timestampCapability(model: AudioTranscriptionModelCapability): string {
  const granularity =
    model.timestampGranularity === 'word'
      ? '词级'
      : model.timestampGranularity === 'segment'
        ? '段级'
        : 'Chunk 范围';
  return model.timestampAvailability === 'best_effort'
    ? `${granularity}（尽力返回）`
    : `${granularity}（回退）`;
}

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
  const [customBusinessRoles, setCustomBusinessRoles] = useState(
    initialValue.customBusinessRoles ?? [],
  );
  const [roleDraft, setRoleDraft] = useState('');
  const [roleError, setRoleError] = useState('');

  const trimmedName = name.trim();
  const submit = () => {
    if (!pending && trimmedName)
      onSubmit({
        name: trimmedName,
        description: description.trim(),
        ...(mode === 'edit' ? { customBusinessRoles } : {}),
      });
  };
  const addRole = () => {
    const role = roleDraft.trim();
    if (!role) return;
    if (CORE_BUSINESS_ROLES.includes(role as (typeof CORE_BUSINESS_ROLES)[number])) {
      setRoleError('核心角色已默认包含，无需重复添加。');
      return;
    }
    if (customBusinessRoles.includes(role)) {
      setRoleError('该自定义角色已存在。');
      return;
    }
    if (customBusinessRoles.length >= 16) {
      setRoleError('每个数据源最多添加 16 个自定义角色。');
      return;
    }
    setCustomBusinessRoles((roles) => [...roles, role]);
    setRoleDraft('');
    setRoleError('');
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
            {mode === 'edit' ? (
              <View>
                <Text style={styles.fieldLabel}>业务角色字典</Text>
                <Text style={styles.roleHint}>核心角色：{CORE_BUSINESS_ROLES.join('、')}</Text>
                <View style={styles.roleInputRow}>
                  <TextInput
                    accessibilityLabel="新增自定义业务角色"
                    maxLength={24}
                    onChangeText={setRoleDraft}
                    onSubmitEditing={addRole}
                    placeholder="例如：售后、技术顾问"
                    placeholderTextColor={textColors.tertiary}
                    style={[styles.nameInput, styles.roleInput]}
                    value={roleDraft}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={addRole}
                    style={({ pressed }) => [styles.roleAddButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.roleAddText}>添加</Text>
                  </Pressable>
                </View>
                <View style={styles.roleChips}>
                  {customBusinessRoles.map((role) => (
                    <Pressable
                      accessibilityLabel={`删除自定义角色：${role}`}
                      accessibilityRole="button"
                      key={role}
                      onPress={() =>
                        setCustomBusinessRoles((roles) =>
                          roles.filter((candidate) => candidate !== role),
                        )
                      }
                      style={styles.roleChip}
                    >
                      <Text style={styles.roleChipText}>{role}</Text>
                      <Ionicons color={colors.secondary} name="close" size={16} />
                    </Pressable>
                  ))}
                </View>
                {roleError ? (
                  <Text accessibilityRole="alert" style={styles.errorText}>
                    {roleError}
                  </Text>
                ) : null}
              </View>
            ) : null}
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

/** 创建或编辑数据源，并在编辑模式维护后置角色识别字典。 */
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

/** 确认唯一的 DashScope 整文件说话人分离转写。 */
export function AudioTranscriptionConfirmDialog({
  audioTitle,
  models,
  onCancel,
  onConfirm,
  onPreprocessingChange,
  pending,
  preprocessing,
  sileroVad,
  visible,
}: {
  audioTitle: string;
  models: AudioTranscriptionModelCapability[];
  onCancel: () => void;
  onConfirm: () => void;
  onPreprocessingChange: (value: AudioTranscriptionPreprocessing) => void;
  pending: boolean;
  preprocessing: AudioTranscriptionPreprocessing;
  sileroVad?: AudioTranscriptionCapabilitiesResponse['sileroVad'];
  visible: boolean;
}) {
  const selectedCapability = models[0];
  const preprocessingAvailable = preprocessing === 'whole_file' || Boolean(sileroVad?.available);
  const selectionAvailable = Boolean(selectedCapability?.available) && preprocessingAvailable;
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.dialogRoot}>
        <View accessibilityViewIsModal style={styles.dialogCard}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            开始 ASR 转写？
          </Text>
          <Text style={styles.dialogBody}>
            将通过 DashScope 官方接口整文件转写“{audioTitle}”。结果按说话人变化或明显停顿分段，
            业务角色和情绪暂标记为未知。
          </Text>
          <Text style={styles.transcriptionSectionTitle}>音频预处理</Text>
          <Pressable
            accessibilityLabel={`空闲音频过滤（Silero VAD）${sileroVad?.available ? '' : '，当前不可用'}`}
            accessibilityRole="radio"
            accessibilityState={{
              checked: preprocessing === 'silero_vad',
              disabled: pending || !sileroVad?.available,
            }}
            disabled={pending || !sileroVad?.available}
            onPress={() => onPreprocessingChange('silero_vad')}
            style={[
              styles.segmentationOption,
              preprocessing === 'silero_vad' && styles.selectedModelOption,
              !sileroVad?.available && styles.disabledButton,
            ]}
          >
            <Ionicons
              color={colors.ink}
              name={preprocessing === 'silero_vad' ? 'radio-button-on' : 'radio-button-off'}
              size={22}
            />
            <View style={styles.transcriptionOptionCopy}>
              <Text style={styles.transcriptionOptionTitle}>空闲音频过滤（Silero VAD）</Text>
              <Text style={styles.secondaryText}>仅压缩连续超过 30 秒的非人声区间</Text>
              {!sileroVad?.available ? (
                <Text accessibilityRole="alert" style={styles.directWarning}>
                  {sileroVad?.unavailableReason ?? 'Silero VAD 能力尚未加载。'}
                </Text>
              ) : null}
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel="保留完整音频"
            accessibilityRole="radio"
            accessibilityState={{ checked: preprocessing === 'whole_file', disabled: pending }}
            disabled={pending}
            onPress={() => onPreprocessingChange('whole_file')}
            style={[
              styles.segmentationOption,
              preprocessing === 'whole_file' && styles.selectedModelOption,
            ]}
          >
            <Ionicons
              color={colors.ink}
              name={preprocessing === 'whole_file' ? 'radio-button-on' : 'radio-button-off'}
              size={22}
            />
            <View style={styles.transcriptionOptionCopy}>
              <Text style={styles.transcriptionOptionTitle}>保留完整音频</Text>
              <Text style={styles.secondaryText}>不执行人声检测，完整音频进入 ASR</Text>
            </View>
          </Pressable>
          <Text style={styles.transcriptionSectionTitle}>正文分段方式</Text>
          <View style={[styles.segmentationOption, styles.selectedModelOption]}>
            <Ionicons color={colors.ink} name="people-outline" size={22} />
            <View style={styles.transcriptionOptionCopy}>
              <Text style={styles.transcriptionOptionTitle}>按说话轮次</Text>
              <Text style={styles.secondaryText}>说话人变化或明显停顿时开始新段</Text>
            </View>
          </View>
          <Text style={styles.transcriptionSectionTitle}>转写模型</Text>
          {!selectedCapability ? (
            <Text accessibilityRole="alert" style={styles.directWarning}>
              转写模型目录加载失败，请关闭后重试。
            </Text>
          ) : (
            <View
              accessibilityLabel={`${selectedCapability.displayName}，${selectedCapability.description}，输入${formatModelPrice(selectedCapability.pricing.input)}，输出${formatModelPrice(selectedCapability.pricing.output)}`}
              style={[
                styles.transcriptionModelOption,
                styles.selectedModelOption,
                !selectedCapability.available && styles.disabledButton,
              ]}
            >
              <Ionicons color={colors.ink} name="hardware-chip-outline" size={22} />
              <View style={styles.transcriptionOptionCopy}>
                <Text style={styles.transcriptionOptionTitle}>
                  {selectedCapability.displayName}
                </Text>
                <Text style={styles.secondaryText}>{selectedCapability.description}</Text>
                <Text style={styles.transcriptionModelMeta}>
                  价格（截至 {selectedCapability.pricing.asOf}）：输入{' '}
                  {formatModelPrice(selectedCapability.pricing.input)} · 输出{' '}
                  {formatModelPrice(selectedCapability.pricing.output)}
                </Text>
                <Text style={styles.transcriptionModelMeta}>
                  时间戳：{timestampCapability(selectedCapability)} · Speaker：尽力分离
                </Text>
                <Text style={styles.transcriptionModelCapabilities}>
                  {selectedCapability.notableCapabilities.join(' · ')}
                </Text>
                {!selectedCapability.available ? (
                  <Text accessibilityRole="alert" style={styles.directWarning}>
                    {selectedCapability.unavailableReason} 当前模式不会静默降级。
                  </Text>
                ) : null}
              </View>
            </View>
          )}
          <View style={styles.dialogActions}>
            <Pressable disabled={pending} onPress={onCancel} style={styles.dialogButton}>
              <Text style={styles.dialogButtonText}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: pending || models.length === 0 || !selectionAvailable,
              }}
              disabled={pending || models.length === 0 || !selectionAvailable}
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
  roleHint: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  roleInputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  roleInput: { flex: 1 },
  roleAddButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  roleAddText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  roleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  roleChip: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.round,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  roleChipText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
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
  segmentationOptions: { flexDirection: 'row', gap: spacing.sm },
  segmentationOption: {
    alignItems: 'flex-start',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  transcriptionModelList: { maxHeight: 260 },
  transcriptionModelOption: {
    alignItems: 'flex-start',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.sm,
  },
  selectedModelOption: { borderColor: colors.ink, backgroundColor: colors.background },
  transcriptionModelMeta: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  transcriptionModelCapabilities: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
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
