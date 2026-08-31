/**
 * 知识库目录页面。
 *
 * 从服务器加载知识库列表并提供创建、错误重试和详情导航，是知识库标签的首个数据入口。
 *
 * Responsibilities:
 * - 展示知识库加载、空状态和列表。
 * - 校验创建表单并提交新知识库。
 *
 * Notes:
 * - 列表数据不写入本地存储。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
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
import type { KnowledgeBaseSummary } from '@echowave/contracts';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { showComingSoon } from '../components/feedback';
import { createKnowledgeBase, listKnowledgeBases } from '../apiClient';

/** 展示创建知识库时由服务端默认值锁定的配置项。 */
function ReadonlySetting({ label, value }: { label: string; value: string }) {
  return (
    <View
      accessibilityLabel={`${label}：${value}，不可修改`}
      accessibilityState={{ disabled: true }}
      accessible
      style={styles.readonlySetting}
    >
      <Text style={styles.readonlyLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.readonlyValue}>
        {value}
      </Text>
    </View>
  );
}

/** 加载知识库目录并提供创建与详情导航。 */
export function KnowledgeListScreen({
  onOpenKnowledge,
}: {
  onOpenKnowledge: (id: string) => void;
}) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const runInitialRequest = useInitialRequestLoading();
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setKnowledgeBases((await listKnowledgeBases()).items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '知识库加载失败。');
    } finally {
      setLoading(false);
    }
  }, []);
  const create = async () => {
    const name = createName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError('');
    try {
      const knowledgeBase = await createKnowledgeBase(name, createDescription.trim());
      setKnowledgeBases((items) => [knowledgeBase, ...items]);
      setShowCreate(false);
      setCreateName('');
      setCreateDescription('');
      onOpenKnowledge(knowledgeBase.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '知识库创建失败。');
    } finally {
      setCreating(false);
    }
  };
  useEffect(() => {
    const task = setTimeout(() => void runInitialRequest(load), 0);
    return () => clearTimeout(task);
  }, [load, runInitialRequest]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          知识库
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="搜索知识库"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => showComingSoon('知识库搜索')}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons color={colors.ink} name="search-outline" size={30} />
          </Pressable>
          <Pressable
            accessibilityLabel="新建知识库"
            accessibilityRole="button"
            disabled={loading || creating}
            onPress={() => setShowCreate((current) => !current)}
            style={({ pressed }) => [
              styles.createButton,
              (loading || creating) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons color={colors.ink} name="add" size={24} />
            <Text style={styles.createText}>新建</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {showCreate ? (
          <View accessibilityLabel="新建知识库表单" style={styles.createPanel}>
            <TextInput
              accessibilityLabel="知识库名称"
              maxLength={120}
              onChangeText={setCreateName}
              placeholder="知识库名称"
              style={styles.input}
              value={createName}
            />
            <TextInput
              accessibilityLabel="知识库描述"
              maxLength={1000}
              multiline
              onChangeText={setCreateDescription}
              placeholder="描述（可选）"
              style={[styles.input, styles.descriptionInput]}
              value={createDescription}
            />
            <View style={styles.settingsSection}>
              <Text style={styles.settingsTitle}>内容存储</Text>
              <ReadonlySetting label="存储位置" value="本地" />
            </View>
            <View style={styles.settingsSection}>
              <Text style={styles.settingsTitle}>知识解析</Text>
              <ReadonlySetting label="索引方式" value="检索增强（RAG）" />
              <ReadonlySetting label="嵌入模型" value="qwen3.7-text-embedding" />
              <ReadonlySetting label="重排序模型" value="未启用" />
            </View>
            <View style={styles.settingsSection}>
              <Text style={styles.settingsTitle}>解析处理</Text>
              <ReadonlySetting label="解析方式" value="自动解析" />
            </View>
            <View style={styles.createActions}>
              <Pressable accessibilityRole="button" onPress={() => setShowCreate(false)}>
                <Text style={styles.retry}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!createName.trim() || creating}
                onPress={() => void create()}
                style={[styles.submitButton, (!createName.trim() || creating) && styles.disabled]}
              >
                <Text style={styles.createText}>{creating ? '正在创建…' : '创建并打开'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {loading ? (
          <ActivityIndicator accessibilityLabel="正在加载知识库" color={colors.ink} />
        ) : null}
        {error ? (
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.feedback}>
            <Text style={styles.description}>{error}</Text>
            <Text style={styles.retry}>点击重试</Text>
          </Pressable>
        ) : null}
        {knowledgeBases.map((knowledge) => (
          <Pressable
            key={knowledge.id}
            accessibilityLabel={`打开知识库：${knowledge.name}`}
            accessibilityRole="button"
            onPress={() => onOpenKnowledge(knowledge.id)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <View style={styles.cardTitleRow}>
              <Ionicons
                color={colors.secondary}
                name="library-outline"
                size={typography.heading1.lineHeight}
              />
              <Text style={styles.cardTitle}>{knowledge.name}</Text>
            </View>
            <Text numberOfLines={2} style={styles.description}>
              {knowledge.description || '暂无描述'}
            </Text>
            <Text style={styles.meta}>
              {knowledge.documentCount} 份文档 · 关联 {knowledge.linkedGroupCount} 个分组
            </Text>
            <Text style={styles.updated}>
              更新于 {new Date(knowledge.updatedAt).toLocaleDateString()}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 92,
    paddingHorizontal: spacing.md,
  },
  title: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  createButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.base,
  },
  createText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    minHeight: 166,
    padding: spacing.md,
  },
  feedback: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  createPanel: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    color: textColors.primary,
    minHeight: 44,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  descriptionInput: { minHeight: 88, textAlignVertical: 'top' },
  settingsSection: { gap: spacing.xs },
  settingsTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  readonlySetting: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 40,
    opacity: 0.72,
    paddingHorizontal: spacing.sm,
  },
  readonlyLabel: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  readonlyValue: {
    ...typography.description,
    color: textColors.secondary,
    flexShrink: 1,
    fontFamily: fontFamilies.sans,
    marginLeft: spacing.sm,
  },
  createActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  submitButton: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  disabled: { opacity: 0.45 },
  retry: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sansBold },
  pressed: {
    backgroundColor: colors.background,
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.heading2,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  description: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    minHeight: 40,
  },
  meta: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  updated: {
    ...typography.body,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
});
