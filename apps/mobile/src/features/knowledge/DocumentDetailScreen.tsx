/** Implements parsed-block inspection and local document preview for one library file. */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSwipePager } from "../../components/useSwipePager";
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "../../theme/tokens";
import {
  ActionButton,
  DocumentFormatIcon,
  EmptyState,
  PageHeader,
  PageTabs,
  SearchAndFilter,
  showComingSoon,
} from "./KnowledgeShared";
import {
  getKnowledgeDocument,
  type DocumentPreview,
  type ParsedBlock,
} from "./mockData";
import { getImportantBlockIds, setBlockImportant } from "./preferences";

const fileTabs = [
  { key: "parsed", label: "文档解析" },
  { key: "original", label: "文档原文" },
] as const;
type FileTab = (typeof fileTabs)[number]["key"];
const fileTabKeys = fileTabs.map((tab) => tab.key);
type PreviewMode = "preview" | "code";

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function PreviewPanel({
  fullscreen,
  mode,
  onChangeMode,
  onToggleFullscreen,
  preview,
}: {
  fullscreen: boolean;
  mode: PreviewMode;
  onChangeMode: (mode: PreviewMode) => void;
  onToggleFullscreen: () => void;
  preview: DocumentPreview;
}) {
  const content =
    mode === "preview" ? (
      <View style={styles.previewBody}>
        <Text accessibilityRole="header" style={styles.previewTitle}>
          {preview.title}
        </Text>
        {preview.sections.map((section) => (
          <View key={section.id} style={styles.previewSection}>
            <Text style={styles.previewSectionTitle}>{section.title}</Text>
            <Text style={styles.previewText}>{section.body}</Text>
          </View>
        ))}
      </View>
    ) : (
      <Text selectable style={styles.codeText}>
        {preview.markdownSource}
      </Text>
    );

  return (
    <View style={[styles.previewPanel, fullscreen && styles.fullscreenPanel]}>
      <View style={styles.previewToolbar}>
        <View accessibilityRole="tablist" style={styles.previewModeTabs}>
          {(["preview", "code"] as const).map((item) => {
            const selected = item === mode;
            return (
              <Pressable
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => onChangeMode(item)}
                style={({ pressed }) => [
                  styles.previewModeTab,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.previewModeText,
                    selected && styles.previewModeTextActive,
                  ]}
                >
                  {item === "preview" ? "预览" : "代码"}
                </Text>
                <View
                  style={[
                    styles.previewModeLine,
                    selected && styles.previewModeLineActive,
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityLabel="调整预览缩放"
          accessibilityRole="button"
          onPress={() => showComingSoon("文档缩放")}
          style={({ pressed }) => [
            styles.toolbarButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.zoomText}>100%</Text>
          <Ionicons color={colors.ink} name="chevron-down" size={16} />
        </Pressable>
        <Pressable
          accessibilityLabel={fullscreen ? "退出全屏预览" : "进入全屏预览"}
          accessibilityRole="button"
          onPress={onToggleFullscreen}
          style={({ pressed }) => [
            styles.toolbarIconButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            color={colors.ink}
            name={fullscreen ? "contract-outline" : "expand-outline"}
            size={24}
          />
        </Pressable>
      </View>
      {fullscreen ? (
        <ScrollView contentContainerStyle={styles.fullscreenContent}>
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </View>
  );
}

function BlockCard({
  block,
  important,
  onOpen,
  onToggleImportant,
  targeted,
}: {
  block: ParsedBlock;
  important: boolean;
  onOpen: () => void;
  onToggleImportant: () => void;
  targeted: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={`打开文本块 ${block.index}：${block.title}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.blockCard,
        targeted && styles.targetedBlock,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.blockTitleRow}>
        <Text style={styles.blockTitle}>
          块 {block.index} · {block.title}
        </Text>
        <Pressable
          accessibilityLabel={important ? "取消重点" : "设为重点"}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: important }}
          hitSlop={8}
          onPress={(event) => {
            event?.stopPropagation();
            onToggleImportant();
          }}
          style={({ pressed }) => [
            styles.starButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            color={colors.ink}
            name={important ? "star" : "star-outline"}
            size={24}
          />
        </Pressable>
      </View>
      <Text numberOfLines={2} style={styles.blockExcerpt}>
        {block.content}
      </Text>
      <View style={styles.blockMetaRow}>
        <Text style={styles.blockMeta}>向量 ID：{block.vectorId}</Text>
        <Text style={styles.blockMeta}>字符数：{block.charCount}</Text>
      </View>
      <Ionicons
        color={colors.muted}
        name="chevron-forward"
        size={24}
        style={styles.blockChevron}
      />
    </Pressable>
  );
}

export function DocumentDetailScreen({
  documentId,
  initialBlockId,
  initialTab = "parsed",
  knowledgeId,
  onBack,
  onOpenBlock,
}: {
  documentId: string;
  initialBlockId?: string;
  initialTab?: FileTab;
  knowledgeId: string;
  onBack: () => void;
  onOpenBlock: (blockId: string) => void;
}) {
  const document = getKnowledgeDocument(knowledgeId, documentId);
  const [activeTab, setActiveTab] = useState<FileTab>(initialTab);
  const [query, setQuery] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("preview");
  const [fullscreen, setFullscreen] = useState(false);
  const [originalScrollOffset, setOriginalScrollOffset] = useState(0);
  const [importantIds, setImportantIds] = useState(() =>
    getImportantBlockIds(),
  );
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } =
    useSwipePager({
      activeTab,
      onTabChange: setActiveTab,
      tabs: fileTabKeys,
    });

  useEffect(() => {
    if (!fullscreen) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setFullscreen(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [fullscreen]);

  const filteredBlocks = useMemo(() => {
    if (!document) {
      return [];
    }
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return document.blocks;
    }
    return document.blocks.filter((block) =>
      [block.title, block.content, block.vectorId].some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [document, query]);

  if (!document) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PageHeader onBack={onBack} title="文件详情" />
        <EmptyState
          description="该文件可能已被移除，请返回知识库详情。"
          title="未找到文件"
        />
      </SafeAreaView>
    );
  }

  if (document.status.kind !== "complete") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PageHeader
          icon={document.format}
          onBack={onBack}
          title={document.title}
        />
        <EmptyState
          description="仅解析完成的文档可以查看解析块与原文预览。"
          title="文件尚未解析完成"
        />
      </SafeAreaView>
    );
  }

  const toggleImportant = (blockId: string) => {
    const next = new Set(importantIds);
    const important = !next.has(blockId);
    if (important) {
      next.add(blockId);
    } else {
      next.delete(blockId);
    }
    setBlockImportant(blockId, important);
    setImportantIds(next);
  };

  if (fullscreen) {
    return (
      <SafeAreaView style={styles.fullscreenSafeArea}>
        <PreviewPanel
          fullscreen
          mode={previewMode}
          onChangeMode={setPreviewMode}
          onToggleFullscreen={() => setFullscreen(false)}
          preview={document.preview}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <PageHeader
        icon={document.format}
        onBack={onBack}
        title={document.title}
      />
      <PageTabs activeTab={activeTab} onChange={selectTab} tabs={fileTabs} />
      <ScrollView
        contentOffset={{
          x: initialTab === "original" ? pageWidth : 0,
          y: 0,
        }}
        horizontal
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={handleMomentumScrollEnd}
        pagingEnabled
        ref={pagerRef}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        testID="document-detail-pager"
      >
        <ScrollView
          contentContainerStyle={styles.pageContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[4]}
          style={{ width: pageWidth }}
          testID="document-parsed-scroll"
        >
          <Text style={styles.sectionTitle}>解析状态</Text>
          <Text style={styles.mutedText}>
            解析完成于 {document.status.parsedAt}
          </Text>
          <View style={styles.metricsRow}>
            <Metric label="文本块" value={document.blocks.length} />
            <Metric
              label="字符数"
              value={document.blocks.reduce(
                (sum, block) => sum + block.charCount,
                0,
              )}
            />
            <Metric label="原文件大小" value={document.size} />
            <Metric label="向量数量" value={document.vectorCount} />
          </View>
          <Text style={styles.sectionTitle}>
            文本块列表（{document.blocks.length}）
          </Text>
          <View style={styles.stickySearch}>
            <SearchAndFilter
              onChangeText={setQuery}
              placeholder="搜索解析内容..."
              value={query}
            />
          </View>
          <View style={styles.blockList}>
            {filteredBlocks.length ? (
              filteredBlocks.map((block) => (
                <BlockCard
                  key={block.id}
                  block={block}
                  important={importantIds.has(block.id)}
                  onOpen={() => onOpenBlock(block.id)}
                  onToggleImportant={() => toggleImportant(block.id)}
                  targeted={block.id === initialBlockId}
                />
              ))
            ) : (
              <Text style={styles.noResult}>没有匹配的文本块</Text>
            )}
          </View>
          <ActionButton
            icon="refresh"
            label="重新解析"
            onPress={() => showComingSoon("重新解析")}
          />
        </ScrollView>

        <ScrollView
          contentOffset={{ x: 0, y: originalScrollOffset }}
          contentContainerStyle={styles.pageContent}
          onMomentumScrollEnd={(event) => {
            setOriginalScrollOffset(event.nativeEvent.contentOffset.y);
          }}
          onScrollEndDrag={(event) => {
            setOriginalScrollOffset(event.nativeEvent.contentOffset.y);
          }}
          showsVerticalScrollIndicator={false}
          style={{ width: pageWidth }}
        >
          {initialBlockId ? (
            <View style={styles.locationBanner}>
              <Ionicons color={colors.success} name="location" size={20} />
              <Text style={styles.locationBannerText}>
                已定位到原文：
                {document.blocks.find((block) => block.id === initialBlockId)
                  ?.title ?? "指定文本块"}
              </Text>
            </View>
          ) : null}
          <View style={styles.fileMetadata}>
            <DocumentFormatIcon format={document.format} size={44} />
            <View style={styles.fileMetadataMain}>
              <Text style={styles.fileTitle}>{document.title}</Text>
              <Text style={styles.mutedText}>Markdown · {document.size}</Text>
              <Text style={styles.tertiaryText}>
                更新于 {document.updatedAt}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="下载文档"
              accessibilityRole="button"
              onPress={() => showComingSoon("下载文档")}
              style={({ pressed }) => [
                styles.downloadButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                color={colors.secondary}
                name="cloud-download-outline"
                size={26}
              />
              <Text style={styles.downloadText}>下载</Text>
            </Pressable>
          </View>
          <PreviewPanel
            fullscreen={false}
            mode={previewMode}
            onChangeMode={setPreviewMode}
            onToggleFullscreen={() => setFullscreen(true)}
            preview={document.preview}
          />
          <ActionButton
            icon="refresh"
            label="重新解析"
            onPress={() => showComingSoon("重新解析")}
          />
        </ScrollView>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.card, flex: 1 },
  fullscreenSafeArea: {
    backgroundColor: colors.card,
    flex: 1,
    padding: spacing.sm,
  },
  pager: { flex: 1 },
  pageContent: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  sectionTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
    marginTop: spacing.sm,
  },
  mutedText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  tertiaryText: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  metricsRow: { flexDirection: "row", paddingVertical: spacing.md },
  metric: {
    alignItems: "center",
    borderLeftColor: colors.divider,
    borderLeftWidth: StyleSheet.hairlineWidth,
    flex: 1,
    gap: spacing.sm,
  },
  metricValue: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
    textAlign: "center",
  },
  metricLabel: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    textAlign: "center",
  },
  blockList: { gap: spacing.sm },
  blockCard: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
    paddingRight: spacing.xl,
    position: "relative",
  },
  targetedBlock: { borderColor: colors.success, borderWidth: 2 },
  blockTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  blockTitle: {
    ...typography.heading2,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
  starButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  blockExcerpt: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  blockMetaRow: { flexDirection: "row", justifyContent: "space-between" },
  blockMeta: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  blockChevron: { position: "absolute", right: spacing.xs, top: 76 },
  noResult: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    paddingVertical: spacing.xl,
    textAlign: "center",
  },
  previewPanel: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    overflow: "hidden",
  },
  fullscreenPanel: { flex: 1 },
  previewToolbar: {
    alignItems: "center",
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  previewModeTabs: { flex: 1, flexDirection: "row", gap: spacing.sm },
  previewModeTab: {
    justifyContent: "flex-end",
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  previewModeText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
    paddingBottom: spacing.xs,
  },
  previewModeTextActive: { color: textColors.primary },
  previewModeLine: {
    backgroundColor: "transparent",
    bottom: 0,
    height: 2,
    left: spacing.sm,
    position: "absolute",
    right: spacing.sm,
  },
  previewModeLineActive: { backgroundColor: colors.ink },
  toolbarButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  toolbarIconButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  zoomText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  previewBody: { gap: spacing.md, padding: spacing.lg },
  previewTitle: {
    ...typography.contentDisplay,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
  previewSection: { gap: spacing.sm },
  previewSectionTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
  previewText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  codeText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    padding: spacing.lg,
  },
  fullscreenContent: { paddingBottom: spacing.xl },
  fileMetadata: {
    alignItems: "center",
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    paddingBottom: spacing.md,
    marginTop: spacing.sm,
  },
  stickySearch: {
    backgroundColor: colors.card,
    paddingVertical: spacing.sm,
    zIndex: 1,
  },
  locationBanner: {
    alignItems: "center",
    backgroundColor: colors.successSurface,
    borderRadius: radii.default,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.base,
  },
  locationBannerText: {
    ...typography.body,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
  fileMetadataMain: { flex: 1, gap: spacing.xs },
  fileTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
  downloadButton: {
    alignItems: "center",
    gap: spacing.xs,
    minWidth: 52,
    paddingVertical: spacing.sm,
  },
  downloadText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  pressed: { backgroundColor: colors.background },
});
