/** Renders the local knowledge-library catalogue shown in the Knowledge tab. */
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "../../theme/tokens";
import { showComingSoon } from "./KnowledgeShared";
import { knowledgeBases } from "./mockData";

export function KnowledgeListScreen({
  onOpenKnowledge,
}: {
  onOpenKnowledge: (id: string) => void;
}) {
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
            accessibilityRole="button"
            onPress={() => showComingSoon("新建知识库")}
            style={({ pressed }) => [
              styles.createButton,
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
            <Text style={styles.updated}>更新于 {knowledge.updatedAt}</Text>
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
