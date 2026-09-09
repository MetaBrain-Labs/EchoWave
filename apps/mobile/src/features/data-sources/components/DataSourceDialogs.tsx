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
  type SupportedLanguage,
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
import { AnalysisLanguagePicker } from '@/shared/i18n/AnalysisLanguagePicker';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

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

type TranslationFunction = ReturnType<typeof useAppLanguage>['t'];

function formatModelPrice(
  price: AudioTranscriptionModelCapability['pricing']['input'],
  t: TranslationFunction,
): string {
  if (price.unit === 'included') return t('modelPrice.included');
  const symbol = price.currency === 'CNY' ? '¥' : '$';
  const unit = {
    million_tokens: t('modelPrice.millionTokens'),
    minute: t('modelPrice.minute'),
    second: t('modelPrice.second'),
  }[price.unit];
  return `${symbol}${price.amount}/${unit}`;
}

function timestampCapability(
  model: AudioTranscriptionModelCapability,
  t: TranslationFunction,
): string {
  const granularity =
    model.timestampGranularity === 'word'
      ? t('modelPrice.word')
      : model.timestampGranularity === 'segment'
        ? t('modelPrice.segment')
        : t('modelPrice.chunk');
  return model.timestampAvailability === 'best_effort'
    ? t('modelPrice.bestEffort', { value: granularity })
    : t('modelPrice.fallback', { value: granularity });
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
  const { t } = useAppLanguage();
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
      setRoleError(t('sourceForm.coreRoleDuplicate'));
      return;
    }
    if (customBusinessRoles.includes(role)) {
      setRoleError(t('sourceForm.customRoleDuplicate'));
      return;
    }
    if (customBusinessRoles.length >= 16) {
      setRoleError(t('sourceForm.roleLimit'));
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
          accessibilityLabel={t('sourceForm.close')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {mode === 'create' ? t('sourceForm.create') : t('sourceForm.edit')}
            </Text>
            <Pressable
              accessibilityLabel={t('common.close')}
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
            <Text style={styles.fieldLabel}>{t('sourceForm.name')}</Text>
            <TextInput
              accessibilityLabel={t('sourceForm.name')}
              autoFocus
              maxLength={120}
              onChangeText={setName}
              onSubmitEditing={submit}
              placeholder={t('sourceForm.namePlaceholder')}
              placeholderTextColor={textColors.tertiary}
              returnKeyType="done"
              style={styles.nameInput}
              textAlignVertical="center"
              value={name}
            />
            <Text style={styles.fieldLabel}>{t('sourceForm.description')}</Text>
            <TextInput
              accessibilityLabel={t('sourceForm.descriptionAccessibility')}
              maxLength={1_000}
              multiline
              onChangeText={setDescription}
              placeholder={t('sourceForm.descriptionPlaceholder')}
              placeholderTextColor={textColors.tertiary}
              style={styles.descriptionInput}
              textAlignVertical="top"
              value={description}
            />

            <Text style={styles.sectionTitle}>{t('sourceForm.audioAccess')}</Text>
            <ReadonlyItem
              label={t('sourceForm.accessMethod')}
              value={t('sourceForm.manualUpload')}
            />
            <ReadonlyItem label={t('sourceForm.storageLocation')} value={t('sourceForm.local')} />
            <Text style={styles.sectionTitle}>{t('sourceForm.audioAnalysis')}</Text>
            <ReadonlyItem
              label={t('sourceForm.transcriptionModel')}
              value={transcriptionModel ?? t('sourceForm.serverConfigured')}
            />
            <ReadonlyItem
              label={t('sourceForm.analysisSettings')}
              value={t('sourceForm.enabledByDefault')}
            />
            {mode === 'edit' ? (
              <View>
                <Text style={styles.fieldLabel}>{t('sourceForm.roleDictionary')}</Text>
                <Text style={styles.roleHint}>{t('sourceForm.coreRoles')}</Text>
                <View style={styles.roleInputRow}>
                  <TextInput
                    accessibilityLabel={t('sourceForm.addRoleAccessibility')}
                    maxLength={24}
                    onChangeText={setRoleDraft}
                    onSubmitEditing={addRole}
                    placeholder={t('sourceForm.rolePlaceholder')}
                    placeholderTextColor={textColors.tertiary}
                    style={[styles.nameInput, styles.roleInput]}
                    value={roleDraft}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={addRole}
                    style={({ pressed }) => [styles.roleAddButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.roleAddText}>{t('sourceForm.add')}</Text>
                  </Pressable>
                </View>
                <View style={styles.roleChips}>
                  {customBusinessRoles.map((role) => (
                    <Pressable
                      accessibilityLabel={t('sourceForm.removeRole', { role })}
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
            <Text style={styles.primaryButtonText}>
              {pending ? t('sourceForm.saving') : t('common.confirm')}
            </Text>
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
  const { formatNumber, t } = useAppLanguage();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel={t('sourceGroup.close')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {t('sourceGroup.link')}
            </Text>
            <Pressable
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              style={styles.iconButton}
            >
              <Ionicons color={colors.ink} name="close" size={24} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.groupOptions}>
            {loading ? (
              <ActivityIndicator accessibilityLabel={t('sourceGroup.loading')} color={colors.ink} />
            ) : null}
            {error ? (
              <View style={styles.feedbackBox}>
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {error}
                </Text>
                <Pressable accessibilityRole="button" onPress={onRetry}>
                  <Text style={styles.retryText}>{t('sources.reload')}</Text>
                </Pressable>
              </View>
            ) : null}
            {!loading && !error && allGroups.length === 0 ? (
              <Text style={styles.secondaryText}>{t('sourceGroup.empty')}</Text>
            ) : null}
            {allGroups.map((group) => {
              const linked = linkedGroupIds.has(group.id);
              const selected = selectedGroupIds.has(group.id);
              return (
                <Pressable
                  accessibilityLabel={t('sourceGroup.accessibility', {
                    action: linked
                      ? t('sourceGroup.linked')
                      : selected
                        ? t('sourceGroup.unselect')
                        : t('sourceGroup.select'),
                    name: group.name,
                  })}
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
                      {t('sourceGroup.counts', {
                        audio: formatNumber(group.metrics.audioCount),
                        sources: formatNumber(group.metrics.sourceCount),
                      })}
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
            <Text style={styles.primaryButtonText}>
              {pending ? t('sourceGroup.linking') : t('sourceGroup.confirm')}
            </Text>
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
  const { t } = useAppLanguage();
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
              <Text style={styles.dialogButtonText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onConfirm}
              style={[styles.dialogButton, styles.dialogConfirmButton]}
            >
              <Text style={styles.dialogConfirmText}>
                {pending ? t('sourceDialog.processing') : confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** 在轻量模式真正上传前确认是否把声学情绪分析绑定到首个 ASR Run。 */
export function LightweightUploadConfirmDialog({
  includeAcousticEmotion,
  onCancel,
  onChange,
  onConfirm,
  pending,
  visible,
}: {
  includeAcousticEmotion: boolean;
  onCancel: () => void;
  onChange: (value: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
  visible: boolean;
}) {
  const { t } = useAppLanguage();
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.dialogRoot}>
        <View accessibilityViewIsModal style={styles.dialogCard}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('lightweight.title')}
          </Text>
          <Text style={styles.dialogBody}>{t('lightweight.description')}</Text>
          <Pressable
            accessibilityLabel={t('asr.includeEmotion')}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: includeAcousticEmotion, disabled: pending }}
            disabled={pending}
            onPress={() => onChange(!includeAcousticEmotion)}
            style={[
              styles.segmentationOption,
              includeAcousticEmotion && styles.selectedModelOption,
            ]}
          >
            <Ionicons
              color={colors.ink}
              name={includeAcousticEmotion ? 'checkbox' : 'square-outline'}
              size={22}
            />
            <View style={styles.transcriptionOptionCopy}>
              <Text style={styles.transcriptionOptionTitle}>{t('asr.includeEmotion')}</Text>
              <Text style={styles.secondaryText}>{t('lightweight.pipeline')}</Text>
              {!includeAcousticEmotion ? (
                <Text style={styles.directWarning}>{t('lightweight.warning')}</Text>
              ) : null}
            </View>
          </Pressable>
          <View style={styles.dialogActions}>
            <Pressable disabled={pending} onPress={onCancel} style={styles.dialogButton}>
              <Text style={styles.dialogButtonText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onConfirm}
              style={[styles.dialogButton, styles.dialogConfirmButton]}
            >
              <Text style={styles.dialogConfirmText}>
                {pending ? t('lightweight.uploading') : t('lightweight.confirmUpload')}
              </Text>
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
  expectedSpeakerCount,
  includeAcousticEmotion = true,
  models,
  onCancel,
  onConfirm,
  onExpectedSpeakerCountChange,
  onIncludeAcousticEmotionChange,
  onPreprocessingChange,
  pending,
  preprocessing,
  sileroVad,
  showAcousticEmotionOption = false,
  visible,
  language = 'zh-CN',
  onLanguageChange,
}: {
  audioTitle: string;
  expectedSpeakerCount: string;
  includeAcousticEmotion?: boolean;
  models: AudioTranscriptionModelCapability[];
  onCancel: () => void;
  onConfirm: () => void;
  onExpectedSpeakerCountChange: (value: string) => void;
  onIncludeAcousticEmotionChange?: (value: boolean) => void;
  onPreprocessingChange: (value: AudioTranscriptionPreprocessing) => void;
  pending: boolean;
  preprocessing: AudioTranscriptionPreprocessing;
  sileroVad?: AudioTranscriptionCapabilitiesResponse['sileroVad'];
  showAcousticEmotionOption?: boolean;
  visible: boolean;
  language?: SupportedLanguage;
  onLanguageChange?: (language: SupportedLanguage) => void;
}) {
  const { t } = useAppLanguage();
  const selectedCapability = models[0];
  const parsedSpeakerCount = Number(expectedSpeakerCount);
  const speakerCountValid =
    expectedSpeakerCount.length === 0 ||
    (/^\d+$/.test(expectedSpeakerCount) &&
      Number.isInteger(parsedSpeakerCount) &&
      parsedSpeakerCount >= 2 &&
      parsedSpeakerCount <= 100);
  const preprocessingAvailable = preprocessing === 'whole_file' || Boolean(sileroVad?.available);
  const selectionAvailable =
    Boolean(selectedCapability?.available) && preprocessingAvailable && speakerCountValid;
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.dialogRoot}>
        <View accessibilityViewIsModal style={[styles.dialogCard, styles.transcriptionDialogCard]}>
          <ScrollView
            contentContainerStyle={styles.transcriptionDialogContent}
            showsVerticalScrollIndicator={false}
            style={styles.transcriptionDialogScroll}
          >
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {t('asr.confirmTitle')}
            </Text>
            <Text style={styles.dialogBody}>
              {t('asr.confirmDescription', { title: audioTitle })}
            </Text>
            <Text style={styles.transcriptionSectionTitle}>{t('analysisLanguage.title')}</Text>
            <AnalysisLanguagePicker
              value={language}
              onChange={onLanguageChange ?? (() => undefined)}
            />
            <Text style={styles.transcriptionSectionTitle}>{t('asr.preprocessing')}</Text>
            <Pressable
              accessibilityLabel={t('asr.vadTitle')}
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
                <Text style={styles.transcriptionOptionTitle}>{t('asr.vadTitle')}</Text>
                <Text style={styles.secondaryText}>{t('asr.vadDescription')}</Text>
                {!sileroVad?.available ? (
                  <Text accessibilityRole="alert" style={styles.directWarning}>
                    {sileroVad?.available ? null : t('asr.vadUnavailable')}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            <Pressable
              accessibilityLabel={t('asr.wholeFile')}
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
                <Text style={styles.transcriptionOptionTitle}>{t('asr.wholeFile')}</Text>
                <Text style={styles.secondaryText}>{t('asr.wholeFileDescription')}</Text>
              </View>
            </Pressable>
            <Text style={styles.transcriptionSectionTitle}>{t('asr.segmentation')}</Text>
            <View style={[styles.segmentationOption, styles.selectedModelOption]}>
              <Ionicons color={colors.ink} name="people-outline" size={22} />
              <View style={styles.transcriptionOptionCopy}>
                <Text style={styles.transcriptionOptionTitle}>{t('asr.speakerTurns')}</Text>
                <Text style={styles.secondaryText}>{t('asr.speakerTurnsDescription')}</Text>
              </View>
            </View>
            <Text style={styles.transcriptionSectionTitle}>{t('asr.speakerCount')}</Text>
            <TextInput
              accessibilityLabel={t('asr.speakerCountInput')}
              editable={!pending}
              inputMode="numeric"
              keyboardType="number-pad"
              maxLength={3}
              onChangeText={(value) => onExpectedSpeakerCountChange(value.replace(/\D/g, ''))}
              placeholder={t('asr.speakerCountPlaceholder')}
              placeholderTextColor={textColors.tertiary}
              style={[styles.speakerCountInput, !speakerCountValid && styles.invalidInput]}
              value={expectedSpeakerCount}
            />
            <Text style={styles.secondaryText}>{t('asr.speakerCountHint')}</Text>
            {!speakerCountValid ? (
              <Text accessibilityRole="alert" style={styles.directWarning}>
                {t('asr.speakerCountInvalid')}
              </Text>
            ) : null}
            {showAcousticEmotionOption ? (
              <>
                <Text style={styles.transcriptionSectionTitle}>{t('asr.acoustic')}</Text>
                <Pressable
                  accessibilityLabel={t('asr.includeEmotion')}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: includeAcousticEmotion, disabled: pending }}
                  disabled={pending}
                  onPress={() => onIncludeAcousticEmotionChange?.(!includeAcousticEmotion)}
                  style={[
                    styles.segmentationOption,
                    includeAcousticEmotion && styles.selectedModelOption,
                  ]}
                >
                  <Ionicons
                    color={colors.ink}
                    name={includeAcousticEmotion ? 'checkbox' : 'square-outline'}
                    size={22}
                  />
                  <View style={styles.transcriptionOptionCopy}>
                    <Text style={styles.transcriptionOptionTitle}>{t('asr.includeEmotion')}</Text>
                    <Text style={styles.secondaryText}>{t('asr.includeEmotionDescription')}</Text>
                    {!includeAcousticEmotion ? (
                      <Text style={styles.directWarning}>{t('asr.emotionDisabledWarning')}</Text>
                    ) : null}
                  </View>
                </Pressable>
              </>
            ) : null}
            <Text style={styles.transcriptionSectionTitle}>{t('asr.model')}</Text>
            {!selectedCapability ? (
              <Text accessibilityRole="alert" style={styles.directWarning}>
                {t('asr.modelUnavailable')}
              </Text>
            ) : (
              <View
                accessibilityLabel={t('modelPrice.accessibility', {
                  name: selectedCapability.displayName,
                  description: selectedCapability.description,
                  input: formatModelPrice(selectedCapability.pricing.input, t),
                  output: formatModelPrice(selectedCapability.pricing.output, t),
                })}
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
                    {t('modelPrice.price', {
                      date: selectedCapability.pricing.asOf,
                      input: formatModelPrice(selectedCapability.pricing.input, t),
                      output: formatModelPrice(selectedCapability.pricing.output, t),
                    })}
                  </Text>
                  <Text style={styles.transcriptionModelMeta}>
                    {t('modelPrice.capabilities', {
                      timestamp: timestampCapability(selectedCapability, t),
                    })}
                  </Text>
                  <Text style={styles.transcriptionModelCapabilities}>
                    {selectedCapability.notableCapabilities.join(' · ')}
                  </Text>
                  {!selectedCapability.available ? (
                    <Text accessibilityRole="alert" style={styles.directWarning}>
                      {t('modelPrice.noFallback', {
                        reason: selectedCapability.unavailableReason ?? '',
                      })}
                    </Text>
                  ) : null}
                </View>
              </View>
            )}
          </ScrollView>
          <View style={styles.dialogActions}>
            <Pressable disabled={pending} onPress={onCancel} style={styles.dialogButton}>
              <Text style={styles.dialogButtonText}>{t('common.cancel')}</Text>
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
              <Text style={styles.dialogConfirmText}>
                {pending ? t('asr.processing') : t('asr.confirm')}
              </Text>
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
  transcriptionDialogCard: { maxHeight: '92%' },
  transcriptionDialogContent: { gap: spacing.md },
  transcriptionDialogScroll: { flexShrink: 1 },
  dialogBody: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  transcriptionSectionTitle: {
    ...typography.label,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  speakerCountInput: {
    ...typography.body,
    backgroundColor: colors.white,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  invalidInput: { borderColor: colors.danger },
  segmentationOptions: { flexDirection: 'row', gap: spacing.sm },
  segmentationOption: {
    alignItems: 'flex-start',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 68,
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
