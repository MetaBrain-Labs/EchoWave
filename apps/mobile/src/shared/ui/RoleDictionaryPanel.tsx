/**
 * 角色识别词典面板。
 *
 * 展示某个数据源在角色识别时使用的角色白名单，并允许直接添加或移除自定义角色。
 *
 * Responsibilities:
 * - 按数据源标识读取自定义角色，并在本地拦截空值、重名、重复和数量上限。
 * - 保存成功后采用服务端返回值，失败时保留原值并交给宿主提示。
 *
 * Notes:
 * - 角色词典属于数据源，是所有分析入口共用的唯一真源；改动只影响之后启动的角色识别。
 * - 核心角色来自契约常量，不可在此增删。
 * - 组件放在 shared 以便多个 feature 复用，两个 feature 之间不互相依赖。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { CORE_BUSINESS_ROLES } from '@echowave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getDataSource, updateDataSource } from '@/shared/api/dataSourcesApi';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import type { TranslationKey } from '@/shared/i18n/translations';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { textInputText } from '@/shared/theme/textInput';

/** 与服务端 CustomBusinessRolesSchema 对齐的数量与长度上限。 */
const MAX_CUSTOM_ROLES = 16;
const MAX_ROLE_LENGTH = 24;

export type RoleDictionaryPanelProps = {
  /** 保存与读取失败时由宿主决定如何提示；组件本身不弹窗。 */
  onError?: (reason: unknown) => void;
  /** 音频或上传对象所属的数据源；为空时不渲染任何内容。 */
  sourceId: string | null | undefined;
};

/** 渲染核心角色、自定义角色与添加入口。 */
export function RoleDictionaryPanel({ onError, sourceId }: RoleDictionaryPanelProps) {
  const { t } = useAppLanguage();
  const [customRoles, setCustomRoles] = useState<string[]>();
  const [draft, setDraft] = useState('');
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [saving, setSaving] = useState(false);
  // 已加载的数据源标识；切换数据源时用它判断是否需要重新读取。
  const [loadedSourceId, setLoadedSourceId] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    // 读取失败时静默隐藏：数据源缺失或已归档不应阻塞宿主页面。
    void getDataSource(sourceId)
      .then((source) => {
        if (!active) return;
        setCustomRoles(source.settings.customBusinessRoles);
        setLoadedSourceId(sourceId);
      })
      .catch(() => {
        if (!active) return;
        setCustomRoles(undefined);
        setLoadedSourceId(sourceId);
      });
    return () => {
      active = false;
    };
  }, [sourceId]);

  const save = useCallback(
    async (next: string[]) => {
      if (!sourceId || saving) return;
      setSaving(true);
      try {
        const saved = await updateDataSource(sourceId, { customBusinessRoles: next });
        setCustomRoles(saved.settings.customBusinessRoles);
      } catch (reason) {
        onError?.(reason);
      } finally {
        setSaving(false);
      }
    },
    [onError, saving, sourceId],
  );

  // 没有数据源、尚未加载完成或读取失败时不渲染；加载中由宿主页面的加载态覆盖。
  if (!sourceId || loadedSourceId !== sourceId || !customRoles) return null;

  const addRole = () => {
    const role = draft.trim();
    if (!role) return;
    if (CORE_BUSINESS_ROLES.includes(role as (typeof CORE_BUSINESS_ROLES)[number])) {
      setErrorKey('sourceForm.coreRoleDuplicate');
      return;
    }
    if (customRoles.includes(role)) {
      setErrorKey('sourceForm.customRoleDuplicate');
      return;
    }
    if (customRoles.length >= MAX_CUSTOM_ROLES) {
      setErrorKey('sourceForm.roleLimit');
      return;
    }
    setDraft('');
    setErrorKey(null);
    void save([...customRoles, role]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('roleDictionary.title')}</Text>
      <Text style={styles.hint}>{t('roleDictionary.coreRolesHint')}</Text>
      <View style={styles.coreChips}>
        {CORE_BUSINESS_ROLES.map((role) => (
          <View key={role} style={styles.coreChip}>
            <Text style={styles.chipText}>{role}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.hint}>{t('roleDictionary.customRolesHint')}</Text>
      {customRoles.length ? (
        <View style={styles.chips}>
          {customRoles.map((role) => (
            <Pressable
              accessibilityLabel={t('sourceForm.removeRole', { role })}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              disabled={saving}
              key={role}
              onPress={() => {
                setErrorKey(null);
                void save(customRoles.filter((candidate) => candidate !== role));
              }}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
              <Text style={styles.chipText}>{role}</Text>
              <Ionicons color={colors.secondary} name="close" size={16} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyText}>{t('roleDictionary.emptyCustomRoles')}</Text>
      )}
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel={t('roleDictionary.addPlaceholder')}
          editable={!saving}
          maxLength={MAX_ROLE_LENGTH}
          onChangeText={(value) => {
            setDraft(value);
            setErrorKey(null);
          }}
          onSubmitEditing={addRole}
          placeholder={t('roleDictionary.addPlaceholder')}
          placeholderTextColor={textColors.tertiary}
          style={styles.input}
          value={draft}
        />
        <Pressable
          accessibilityLabel={t('roleDictionary.add')}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          disabled={saving}
          onPress={addRole}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          {saving ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.addText}>{t('roleDictionary.add')}</Text>
          )}
        </Pressable>
      </View>
      {errorKey ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(errorKey)}
        </Text>
      ) : null}
      {/* 说明作用域：词典属于数据源，且只影响之后启动的角色识别。 */}
      <Text style={styles.scopeHint}>{t('roleDictionary.scopeHint')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  title: { ...typography.heading4, color: textColors.primary, fontFamily: fontFamilies.sansBold },
  hint: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  scopeHint: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
  coreChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  // 核心角色不可编辑，用描边区别于可移除的自定义角色。
  coreChip: {
    borderColor: colors.divider,
    borderRadius: radii.round,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  emptyText: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
  inputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  input: {
    ...textInputText,
    ...typography.body,
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    height: 44,
    paddingHorizontal: spacing.sm,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: spacing.md,
  },
  addText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  error: {
    ...typography.label,
    color: colors.danger,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  pressed: { opacity: 0.65 },
});
