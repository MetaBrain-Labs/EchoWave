/**
 * 租户知识类别维护面板。
 *
 * 新增、编辑用途说明和停用类别，保留失败草稿及服务器版本。
 *
 * Responsibilities:
 * - 不提供硬删除或本地持久化。
 *
 * Notes:
 * - 类别目录变化由服务器使在途分析输入过期。
 */
import type { KnowledgeCategory } from '@echowave/contracts';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, spacing, typography } from '@/shared/theme/tokens';
import { createKnowledgeCategory, updateKnowledgeCategory } from '../apiClient';

/** 管理共享目录，保存成功后刷新而不是制造本地权威副本。 */
export function CategoryManager({
  categories,
  onChanged,
  disabled = false,
}: {
  categories: KnowledgeCategory[];
  onChanged: () => Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useAppLanguage();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeCategory>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const select = (item?: KnowledgeCategory) => {
    setEditing(item);
    setName(item?.name ?? '');
    setDescription(item?.description ?? '');
    setError('');
  };
  const save = async (active?: boolean) => {
    if (pending || disabled || !name.trim() || !description.trim()) return;
    setPending(true);
    setError('');
    try {
      if (editing)
        await updateKnowledgeCategory(editing.id, {
          name: name.trim(),
          description: description.trim(),
          expectedVersion: editing.version,
          ...(active === undefined ? {} : { active }),
        });
      else await createKnowledgeCategory({ name: name.trim(), description: description.trim() });
      await onChanged();
      select();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('common.saveFailed'));
    } finally {
      setPending(false);
    }
  };
  return (
    <View style={styles.panel}>
      <Pressable
        accessibilityRole="button"
        disabled={pending || disabled}
        onPress={() => setOpen(!open)}
        style={styles.button}
      >
        <Text>{t('knowledgeCategory.manage')}</Text>
      </Pressable>
      {open ? (
        <>
          <Text>{t('knowledgeCategory.keepHistory')}</Text>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              disabled={pending || disabled}
              onPress={() => select()}
              style={styles.button}
            >
              <Text>{t('knowledgeCategory.new')}</Text>
            </Pressable>
            {categories.map((item) => (
              <Pressable
                accessibilityRole="button"
                key={item.id}
                disabled={pending || disabled}
                onPress={() => select(item)}
                style={styles.button}
              >
                <Text>
                  {item.name}
                  {!item.active ? ` · ${t('knowledgeCategory.disabled')}` : ''}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel={t('knowledgeCategory.name')}
            value={name}
            onChangeText={setName}
            maxLength={80}
            editable={!pending && !disabled}
            style={styles.input}
          />
          <TextInput
            accessibilityLabel={t('knowledgeCategory.description')}
            value={description}
            onChangeText={setDescription}
            maxLength={1000}
            multiline
            editable={!pending && !disabled}
            style={styles.input}
          />
          {error ? <Text accessibilityRole="alert">{error}</Text> : null}
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              disabled={pending || disabled || !name.trim() || !description.trim()}
              onPress={() => void save()}
              style={styles.button}
            >
              <Text>{t('knowledgeCategory.save')}</Text>
            </Pressable>
            {editing && editing.key !== 'general' ? (
              <Pressable
                accessibilityRole="button"
                disabled={pending || disabled}
                onPress={() => void save(!editing.active)}
                style={styles.button}
              >
                <Text>
                  {t(editing.active ? 'knowledgeCategory.disable' : 'knowledgeCategory.enable')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  button: { padding: spacing.sm, minHeight: 48, justifyContent: 'center' },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.sm,
    minHeight: 48,
  },
});
