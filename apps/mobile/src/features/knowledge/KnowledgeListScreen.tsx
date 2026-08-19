/** Renders the local knowledge-library catalogue shown in the Knowledge tab. */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { KnowledgeBaseSummary } from "@echowave/contracts";

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "../../theme/tokens";
import { showComingSoon } from "./KnowledgeShared";
import { createKnowledgeBase, listKnowledgeBases } from "./apiClient";

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
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          知识库
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="搜索知识库"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => showComingSoon("知识库搜索")}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
            ]}
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

      <ScrollView
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
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
        {loading ? <ActivityIndicator accessibilityLabel="正在加载知识库" color={colors.ink} /> : null}
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
              {knowledge.description}
            </Text>
            <Text style={styles.meta}>
              {knowledge.documentCount} 份文档 · 关联{" "}
              {knowledge.linkedGroupCount} 个分组
            </Text>
            <Text style={styles.updated}>更新于 {new Date(knowledge.updatedAt).toLocaleDateString()}</Text>
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
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 92,
    paddingHorizontal: spacing.md,
  },
  title: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  iconButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  createButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.base,
  },
  createText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
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
  feedback: { alignItems: "center", gap: spacing.sm, padding: spacing.lg },
  createPanel: { backgroundColor: colors.card, borderRadius: radii.default, gap: spacing.sm, padding: spacing.md },
  input: { ...typography.body, backgroundColor: colors.background, borderColor: colors.divider, borderRadius: radii.default, borderWidth: StyleSheet.hairlineWidth, color: textColors.primary, minHeight: 44, paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
  descriptionInput: { minHeight: 88, textAlignVertical: 'top' },
  createActions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  submitButton: { backgroundColor: colors.background, borderRadius: radii.default, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  disabled: { opacity: 0.45 },
  retry: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sansBold },
  pressed: {
    backgroundColor: colors.background,
  },
  cardTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.heading2,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
  description: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
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
