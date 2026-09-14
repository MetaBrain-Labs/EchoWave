/**
 * 案例收集页面局部 UI。
 *
 * 统一此功能的表单、单列布局和对话轮次编辑。
 *
 * Responsibilities:
 * - 复用共享设计 token 和可访问控件。
 * - 仅编辑角色与所选轮次，不改写原音频正文。
 *
 * Notes:
 * - 不作为其他 feature 的组件依赖。
 */
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PageHeader } from '@/shared/ui/PageHeader';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CaseContent, CaseTurn } from '@echowave/contracts';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 原生安全区与桌面 480px 单列学习页面。 */
export function CollectionLayout({
  title,
  onBack,
  children,
  loading,
  error,
  onRetry,
  onRefresh,
  onMore,
  footer,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onRefresh?: () => Promise<void>;
  onMore?: () => void;
  footer?: ReactNode;
}) {
  const { t } = useAppLanguage();
  const refresh = useScreenRefresh(onRefresh ?? (async () => {}));
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.header}>
        <PageHeader title={title} onBack={onBack} onMore={onMore} />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        refreshControl={onRefresh ? <ScreenRefreshControl {...refresh} /> : undefined}
      >
        {loading ? <ActivityIndicator accessibilityLabel={t('collection.loading')} /> : null}
        {error ? (
          <View accessibilityRole="alert">
            <Text style={styles.error}>{error}</Text>
            {onRetry ? <CollectionButton label={t('collection.retry')} onPress={onRetry} /> : null}
          </View>
        ) : null}
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}
/** 最小 44px 的可访问操作按钮。 */
export function CollectionButton({
  label,
  onPress,
  disabled = false,
  selected = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, selected && styles.selected, disabled && styles.disabled]}
    >
      <Text
        style={[
          styles.buttonText,
          selected && styles.selectedText,
          disabled && styles.disabledText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
/** 规则与分组入口沿用白色导航卡片，辅助信息不挤入标题。 */
export function CollectionNavigationRow({
  title,
  description,
  icon,
  onPress,
}: {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.navigationRow, pressed && styles.navigationPressed]}
    >
      {icon ? (
        <View style={styles.navigationIcon}>
          <Ionicons name={icon} size={22} color={textColors.primary} />
        </View>
      ) : null}
      <View style={styles.navigationCopy}>
        <Text style={styles.navigationTitle}>{title}</Text>
        {description ? <Text style={styles.hint}>{description}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={textColors.secondary} />
    </Pressable>
  );
}
/** 紧凑音频行显示原始来源时间；暂停和重试不离开当前轮次。 */
export function CollectionAudioControl({
  label,
  range,
  playing,
  disabled,
  onPress,
  loading,
  error,
  onRetry,
}: {
  label: string;
  range?: string;
  playing: boolean;
  disabled?: boolean;
  onPress: () => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const { t } = useAppLanguage();
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, selected: playing }}
        disabled={disabled}
        onPress={onPress}
        style={styles.audioRow}
      >
        <Ionicons
          name={playing ? 'pause' : 'play'}
          size={20}
          color={disabled ? textColors.tertiary : textColors.primary}
        />
        <Text style={[styles.text, disabled && styles.disabledText]}>{range ?? label}</Text>
      </Pressable>
      {loading ? <Text style={styles.hint}>{t('collection.loadingAudio')}</Text> : null}
      {error ? (
        <View accessibilityRole="alert">
          <Text style={styles.hint}>{error}</Text>
          {onRetry ? (
            <CollectionButton label={t('collection.retryPlayback')} onPress={onRetry} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
/** 带标签的文本输入，不隐藏验证错误。 */
export function CollectionField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.text}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        placeholderTextColor={textColors.secondary}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}
/** 多选列表保持原生 checkbox 语义。 */
export function CollectionCheck({
  label,
  checked,
  onPress,
  single = false,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
  single?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={single ? 'radio' : 'checkbox'}
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.text}>
        {checked ? '☑ ' : '☐ '}
        {label}
      </Text>
    </Pressable>
  );
}
/** 折叠选择器的搜索仅影响展示，选中值由外部权威表单维护。 */
export function CollectionPicker({
  label,
  summary,
  options,
  selectedIds,
  onSelect,
  single = false,
}: {
  label: string;
  summary: string;
  options: { id: string; name: string }[];
  selectedIds: string[];
  onSelect: (id: string) => void;
  single?: boolean;
}) {
  const { t } = useAppLanguage();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const visible = options.filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <View style={styles.field}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={[styles.button, styles.pickerRow]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.text}>{label}</Text>
          <Text style={styles.hint}>{summary}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={textColors.secondary}
        />
      </Pressable>
      {expanded ? (
        <>
          <CollectionField
            label={`${label} · ${t('collection.searchOptions')}`}
            value={query}
            onChange={setQuery}
          />
          {query ? (
            <CollectionButton label={t('collection.clearSearch')} onPress={() => setQuery('')} />
          ) : null}
          {!visible.length ? <Text style={styles.hint}>{t('collection.noMatches')}</Text> : null}
          {visible.map((item) => (
            <CollectionCheck
              key={item.id}
              label={item.name}
              single={single}
              checked={selectedIds.includes(item.id)}
              onPress={() => onSelect(item.id)}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}
/** 原对话文字只读；用户可确认角色与调整选中轮次。 */
export function CaseContentEditor({
  content,
  availableTurns,
  onChange,
}: {
  content: CaseContent;
  availableTurns: CaseTurn[];
  onChange: (value: CaseContent) => void;
}) {
  const { t } = useAppLanguage();
  const field = (key: 'title' | 'reason' | 'supplement' | 'suggestedReply', multiline = false) => (
    <CollectionField
      label={t(`collection.${key}`)}
      value={content[key]}
      multiline={multiline}
      onChange={(value) => onChange({ ...content, [key]: value })}
    />
  );
  return (
    <View style={styles.card}>
      {field('title')}
      {field('reason', true)}
      {field('supplement', true)}
      {field('suggestedReply', true)}
      <CollectionField
        label={t('collection.categoryName')}
        value={content.category.name}
        onChange={(name) => onChange({ ...content, category: { ...content.category, name } })}
      />
      <Text style={styles.heading}>{t('collection.dialogue')}</Text>
      <Text style={styles.hint}>{t('collection.dialogueHint')}</Text>
      {availableTurns.map((original) => {
        const turn = content.turns.find((v) => v.segmentId === original.segmentId);
        return (
          <View style={styles.turn} key={original.segmentId}>
            <CollectionCheck
              label={`${original.speakerLabel} · ${(original.startMs / 1000).toFixed(1)}–${(original.endMs / 1000).toFixed(1)}s`}
              checked={!!turn}
              onPress={() =>
                onChange({
                  ...content,
                  turns: turn
                    ? content.turns.filter((v) => v.segmentId !== original.segmentId)
                    : [...content.turns, original].sort((a, b) => a.startMs - b.startMs),
                })
              }
            />
            <Text style={styles.transcript}>{original.text}</Text>
            {turn ? (
              <View style={styles.row}>
                {(['customer', 'sales', 'unknown'] as const).map((role) => (
                  <CollectionButton
                    key={role}
                    label={t(`collection.${role}`)}
                    selected={turn.role === role}
                    onPress={() =>
                      onChange({
                        ...content,
                        turns: content.turns.map((v) =>
                          v.segmentId === turn.segmentId ? { ...v, role } : v,
                        ),
                      })
                    }
                  />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
/** 案例功能内使用的共享局部样式。 */
export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.card,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radii.default,
  },
  navigationRow: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    borderColor: colors.divider,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  navigationPressed: { backgroundColor: colors.background },
  audioRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  footer: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: colors.card,
  },
  footerAction: { flex: 1 },
  navigationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigationCopy: { flex: 1, gap: spacing.xs },
  navigationTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  heading: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  text: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  hint: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  error: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: { gap: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.background,
    borderRadius: radii.default,
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
    height: 44,
    textAlignVertical: 'center',
    includeFontPadding: false,
    fontFamily: fontFamilies.sans,
    ...typography.body,
    color: textColors.primary,
  },
  multiline: {
    height: undefined,
    minHeight: 96,
    paddingVertical: spacing.sm,
    textAlignVertical: 'top',
  },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radii.default,
  },
  buttonText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  selected: { borderColor: textColors.primary, backgroundColor: colors.card },
  disabled: { backgroundColor: colors.divider },
  disabledText: { color: textColors.secondary },
  selectedText: { fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  displayTitle: {
    ...typography.contentDisplay,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  transcript: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.kai },
  turn: {
    borderTopWidth: 1,
    borderColor: colors.divider,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
});
