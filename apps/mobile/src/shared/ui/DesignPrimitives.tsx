/**
 * EchoWave 通用界面原语。
 *
 * 提供跨业务页面复用的按钮、输入框、内容卡片、导航行、状态与加载反馈。
 *
 * Responsibilities:
 * - 统一主要操作、字段校验、卡片与列表入口的视觉和无障碍语义。
 * - 为空内容、状态消息和延迟内容提供稳定的占位展示。
 *
 * Notes:
 * - 组件不持有业务数据；事件和内容均由调用方提供。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode, type Ref } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { LoadingIndicator, type LoadingDuration } from './LoadingIndicator';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { textInputText } from '@/shared/theme/textInput';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 提供触控尺寸统一并明确 loading 与危险状态的按钮。 */
export function AppButton({
  accessibilityLabel,
  buttonRef,
  children,
  disabled = false,
  icon,
  iconPosition = 'leading',
  loading = false,
  loadingDuration = 'short',
  onPress,
  selected = false,
  style,
  accessibilityHint,
  hitSlop,
  testID,
  textStyle,
  tone = 'primary',
}: {
  accessibilityLabel?: string;
  accessibilityHint?: string;
  buttonRef?: Ref<View>;
  children?: ReactNode;
  disabled?: boolean;
  selected?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'leading' | 'trailing';
  loading?: boolean;
  loadingDuration?: LoadingDuration;
  onPress: () => void;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  textStyle?: StyleProp<TextStyle>;
  tone?: 'primary' | 'secondary' | 'danger';
}) {
  const { t } = useAppLanguage();
  const unavailable = disabled || loading;
  const iconColor =
    tone === 'primary' ? colors.white : tone === 'danger' ? colors.danger : textColors.primary;
  const iconElement = loading ? (
    <LoadingIndicator
      accessibilityLabel={t('common.submitting')}
      delayMs={0}
      duration={loadingDuration}
      size={24}
    />
  ) : icon ? (
    <Ionicons color={iconColor} name={icon} size={20} />
  ) : null;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, busy: loading, selected }}
      disabled={unavailable}
      hitSlop={hitSlop}
      onPress={onPress}
      ref={buttonRef}
      style={({ pressed }) => [
        styles.button,
        style,
        tone === 'primary' && styles.buttonPrimary,
        tone === 'danger' && styles.buttonDanger,
        tone === 'secondary' && styles.buttonSecondary,
        selected && tone === 'secondary' && styles.buttonSelected,
        pressed && !unavailable && tone === 'primary' && styles.buttonPressedPrimary,
        pressed && !unavailable && tone === 'secondary' && styles.buttonPressedSecondary,
        pressed && !unavailable && tone === 'danger' && styles.buttonPressedDanger,
        unavailable && styles.buttonDisabled,
      ]}
      testID={testID}
    >
      {iconElement && iconPosition === 'leading' ? (
        <View style={styles.buttonIcon} testID="app-button-leading-icon">
          {iconElement}
        </View>
      ) : null}
      {children != null ? (
        <Text
          style={[
            styles.buttonText,
            tone === 'primary' && styles.buttonPrimaryText,
            tone === 'danger' && styles.buttonDangerText,
            textStyle,
          ]}
        >
          {children}
        </Text>
      ) : null}
      {iconElement && iconPosition === 'trailing' ? (
        <View style={styles.buttonIcon} testID="app-button-trailing-icon">
          {iconElement}
        </View>
      ) : null}
    </Pressable>
  );
}

/** 单选与复选项共用品牌色标记，具体点击语义由所在行提供。 */
export function SelectionMark({
  checked,
  kind,
  size = 22,
}: {
  checked: boolean;
  kind: 'checkbox' | 'radio';
  size?: number;
}) {
  const name =
    kind === 'radio'
      ? checked
        ? 'radio-button-on'
        : 'radio-button-off'
      : checked
        ? 'checkbox'
        : 'square-outline';

  return (
    <Ionicons color={checked ? colors.primary : textColors.tertiary} name={name} size={size} />
  );
}

/** 呈现含标签、帮助和字段错误的单行表单控件。 */
export function FormField({
  error,
  hint,
  inputRef,
  hideLabel = false,
  inputContainerStyle,
  label,
  secureTextEntry,
  style: inputStyle,
  containerStyle,
  editable,
  ...inputProps
}: TextInputProps & {
  containerStyle?: StyleProp<ViewStyle>;
  error?: string;
  hideLabel?: boolean;
  hint?: string;
  inputContainerStyle?: StyleProp<ViewStyle>;
  inputRef?: Ref<TextInput>;
  label: string;
}) {
  const { t } = useAppLanguage();
  const [hidden, setHidden] = useState(secureTextEntry ?? false);
  const { multiline, placeholder, ...nativeInputProps } = inputProps;
  return (
    <View style={[styles.field, containerStyle]}>
      {!hideLabel ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View
        style={[
          styles.inputWrap,
          inputContainerStyle,
          multiline && styles.inputWrapMultiline,
          error ? styles.inputInvalid : null,
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          autoCorrect={false}
          editable={editable}
          multiline={multiline}
          placeholder={placeholder ?? label}
          placeholderTextColor={textColors.tertiary}
          ref={inputRef}
          secureTextEntry={secureTextEntry ? hidden : false}
          style={[styles.input, multiline && styles.multilineInput, inputStyle]}
          {...nativeInputProps}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityLabel={hidden ? t('common.showPassword') : t('common.hidePassword')}
            accessibilityRole="button"
            onPress={() => setHidden((value) => !value)}
            style={styles.visibilityButton}
          >
            <Ionicons
              color={textColors.secondary}
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={20}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.fieldError}>
          {error}
        </Text>
      ) : null}
      {!error && hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/** 承载单一主题内容的轻边框白色卡片。 */
export function ContentCard({
  accessibilityHint,
  accessibilityLabel,
  children,
  onPress,
  style,
  testID,
}: {
  accessibilityHint?: string;
  accessibilityLabel?: string;
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  if (!onPress)
    return (
      <View style={[styles.card, style]} testID={testID}>
        {children}
      </View>
    );
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, style, pressed && styles.rowPressed]}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

/** 展示名称、摘要和元数据一致的可进入资源卡片。 */
export function ResourceCard({
  accessibilityHint,
  accessibilityLabel,
  children,
  disabled = false,
  icon,
  onPress,
  style,
  testID,
  trailing,
  title,
}: {
  accessibilityHint?: string;
  accessibilityLabel: string;
  children: ReactNode;
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  trailing?: ReactNode;
  title: string;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.resourceCard,
        style,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.buttonDisabled,
      ]}
      testID={testID}
    >
      <View style={styles.resourceTitleRow}>
        <View style={styles.resourceIcon}>
          <Ionicons color={colors.primary} name={icon} size={22} />
        </View>
        <Text style={styles.resourceTitle}>{title}</Text>
        {trailing ?? <Ionicons color={textColors.tertiary} name="chevron-forward" size={20} />}
      </View>
      <View style={styles.resourceContent}>{children}</View>
    </Pressable>
  );
}

/** 整行可点击的导航入口，并为描述预留两行高度。 */
export function NavigationRow({
  accessibilityLabel,
  description,
  disabled = false,
  icon,
  iconTestID,
  onPress,
  title,
  testID,
  trailing,
  style,
  rowRef,
}: {
  accessibilityLabel?: string;
  description?: string;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconTestID?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  trailing?: ReactNode;
  title: string;
  rowRef?: Ref<View>;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      ref={rowRef}
      style={({ pressed }) => [styles.navigationRow, style, pressed && styles.rowPressed]}
      testID={testID}
    >
      {icon ? (
        <View style={styles.navigationIcon} testID={iconTestID}>
          <Ionicons color={colors.primary} name={icon} size={20} />
        </View>
      ) : null}
      <View style={styles.navigationCopy}>
        <Text style={styles.navigationTitle}>{title}</Text>
        {description ? (
          <Text numberOfLines={2} style={styles.navigationDescription}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing ?? <Ionicons color={textColors.tertiary} name="chevron-forward" size={20} />}
    </Pressable>
  );
}

/** 展示带文字标签的轻量状态标记。 */
export function StatusBadge({
  accessibilityLabel,
  label,
  tone = 'neutral',
}: {
  accessibilityLabel?: string;
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'ai';
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessible
      style={[styles.badge, styles[`badge_${tone}`]]}
    >
      <Text style={[styles.badgeText, styles[`badgeText_${tone}`]]}>{label}</Text>
    </View>
  );
}

/** 解释空页面缘由，并直接展示用户可以采取的操作。 */
export function EmptyState({
  accessibilityRole,
  action,
  description,
  icon = 'file-tray-outline',
  style,
  title,
}: {
  accessibilityRole?: 'alert';
  action?: ReactNode;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  title: string;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={accessibilityRole}
      style={[styles.emptyState, style]}
    >
      <Ionicons color={textColors.secondary} name={icon} size={32} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {description ? <Text style={styles.emptyDescription}>{description}</Text> : null}
      {action}
    </View>
  );
}

/** 为加载和操作结果提供可访问的局部提示。 */
export function InlineFeedback({
  action,
  message,
  style,
  tone = 'info',
}: {
  action?: ReactNode;
  message: string;
  style?: StyleProp<ViewStyle>;
  tone?: 'info' | 'success' | 'warning' | 'danger';
}) {
  return (
    <View style={[styles.feedback, styles[`feedback_${tone}`], style]}>
      <Text accessibilityRole="alert" style={styles.feedbackText}>
        {message}
      </Text>
      {action}
    </View>
  );
}

/** 预留内容尺寸，避免次要数据到达时页面整体跳动。 */
export function SkeletonBlock({
  height = 20,
  width = '100%',
}: {
  height?: number;
  width?: number | `${number}%`;
}) {
  const { t } = useAppLanguage();
  return (
    <View
      accessible
      accessibilityLabel={t('common.loadingContent')}
      style={[styles.skeleton, { height, width }]}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.button,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  buttonIcon: { alignItems: 'center', height: 24, justifyContent: 'center', width: 24 },
  buttonDanger: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  buttonSecondary: { backgroundColor: colors.white },
  buttonSelected: { backgroundColor: colors.primarySurface, borderColor: colors.primary },
  buttonPressedPrimary: {
    backgroundColor: colors.primaryActive,
    borderColor: colors.primaryActive,
  },
  buttonPressedSecondary: { backgroundColor: colors.primarySurface },
  buttonPressedDanger: { backgroundColor: colors.dangerSurface },
  buttonDisabled: { opacity: 0.56 },
  buttonText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sansBold },
  buttonPrimaryText: { color: colors.white },
  buttonDangerText: { color: colors.danger },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sansBold },
  inputWrap: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.divider,
    borderRadius: radii.input,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  inputWrapMultiline: { alignItems: 'stretch', paddingVertical: spacing.sm },
  inputInvalid: { borderColor: colors.danger },
  input: { ...textInputText, flex: 1, minWidth: 0, paddingHorizontal: 0 },
  multilineInput: { minHeight: 88, paddingVertical: spacing.sm, textAlignVertical: 'top' },
  visibilityButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  fieldError: { ...typography.description, color: colors.danger },
  fieldHint: { ...typography.description, color: textColors.secondary },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    padding: spacing.md,
  },
  navigationRow: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowPressed: { backgroundColor: colors.primarySurface },
  navigationIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySurface,
    borderRadius: radii.round,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  navigationCopy: { flex: 1, gap: spacing.xs, minHeight: 40, justifyContent: 'center' },
  navigationTitle: {
    ...typography.cardTitle,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  navigationDescription: { ...typography.description, color: textColors.secondary },
  resourceCard: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  resourceTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  resourceIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySurface,
    borderRadius: radii.input,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  resourceTitle: {
    ...typography.cardTitle,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
  },
  resourceContent: { gap: spacing.xs, paddingLeft: 40 + spacing.sm },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.round,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badge_neutral: { backgroundColor: colors.surfaceSecondary },
  badge_success: { backgroundColor: colors.successSurface },
  badge_warning: { backgroundColor: colors.warningSurface },
  badge_danger: { backgroundColor: colors.dangerSurface },
  badge_ai: { backgroundColor: colors.aiSurface },
  badgeText: { ...typography.description, color: textColors.secondary, textAlign: 'center' },
  badgeText_neutral: { color: textColors.secondary },
  badgeText_success: { color: colors.success },
  badgeText_warning: { color: colors.warning },
  badgeText_danger: { color: colors.danger },
  badgeText_ai: { color: colors.ai },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    ...typography.cardTitle,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    textAlign: 'center',
  },
  emptyDescription: { ...typography.body, color: textColors.secondary, textAlign: 'center' },
  feedback: {
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  feedback_info: { backgroundColor: colors.primarySurface, borderColor: colors.primaryBorder },
  feedback_success: { backgroundColor: colors.successSurface, borderColor: colors.success },
  feedback_warning: { backgroundColor: colors.warningSurface, borderColor: colors.warning },
  feedback_danger: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  feedbackText: { ...typography.body, color: textColors.primary },
  skeleton: { backgroundColor: colors.surfaceSecondary, borderRadius: radii.input },
});
