/** Implements the sketch-inspired group workspace and its three content tabs. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, spacing, typeScale } from '../../theme/tokens';
import {
  audioItems,
  dataSources,
  knowledgeBases,
  type AudioItem,
} from './mockData';

const tabs = [
  { key: 'audio', label: '音频分析' },
  { key: 'knowledge', label: '关联知识库' },
  { key: 'sources', label: '连接数据源' },
] as const;

type TabKey = (typeof tabs)[number]['key'];

function showComingSoon(feature: string) {
  Alert.alert('功能建设中', `${feature}将在后续版本开放。`);
}

function IconButton({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={10}
      onPress={() => showComingSoon(label)}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Ionicons color={colors.ink} name={icon} size={29} />
    </Pressable>
  );
}

function AudioStatusView({ status }: Pick<AudioItem, 'status'>) {
  switch (status.kind) {
    case 'complete':
      return <Text style={styles.statusText}>{status.duration}</Text>;
    case 'waiting':
      return (
        <View style={styles.inlineStatus}>
          <Ionicons color={colors.ink} name="hourglass-outline" size={18} />
          <Text style={styles.statusText}>待分析</Text>
        </View>
      );
    case 'uploading':
      return (
        <View style={styles.inlineStatus}>
          <ActivityIndicator color={colors.ink} size="small" />
          <Text style={styles.statusText}>上传中</Text>
        </View>
      );
    case 'analyzing':
      return <Text style={styles.statusText}>分析中 ({status.progress}%)</Text>;
  }
}

function AudioContent() {
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>共 {audioItems.length} 份音频</Text>
        <Pressable
          accessibilityLabel="排序筛选"
          accessibilityRole="button"
          onPress={() => showComingSoon('排序筛选')}
          style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
        >
          <Text style={styles.filterText}>排序筛选</Text>
          <Ionicons color={colors.secondary} name="filter-outline" size={20} />
        </Pressable>
      </View>
      {audioItems.map((item) => (
        <View key={item.id} style={styles.card}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <View style={styles.audioMetaRow}>
            <Text style={styles.metaText}>时间 {item.createdAt}</Text>
            <AudioStatusView status={item.status} />
          </View>
          {item.sharedFrom ? (
            <View style={styles.sharedRow}>
              <Ionicons color={colors.muted} name="swap-horizontal" size={18} />
              <Text style={styles.metaText}>来自 {item.sharedFrom}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </>
  );
}

function KnowledgeContent() {
  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionHeaderSolo]}>
        共关联 {knowledgeBases.length} 个知识库
      </Text>
      {knowledgeBases.map((knowledgeBase) => (
        <View key={knowledgeBase.id} style={styles.card}>
          <View style={styles.titleRow}>
            <Ionicons color={colors.ink} name="file-tray-stacked-outline" size={22} />
            <Text style={styles.cardTitle}>{knowledgeBase.name}</Text>
          </View>
          <Text numberOfLines={2} style={styles.description}>
            {knowledgeBase.description}
          </Text>
          <Text style={styles.metaText}>共 {knowledgeBase.documentCount} 份文档</Text>
          <Text style={styles.metaText}>更新于 {knowledgeBase.updatedAt}</Text>
        </View>
      ))}
    </>
  );
}

function SourcesContent() {
  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionHeaderSolo]}>
        共连接 {dataSources.length} 个数据源
      </Text>
      {dataSources.map((source) => (
        <View key={source.id} style={styles.card}>
          <View style={styles.sourceTitleRow}>
            <View style={styles.titleRow}>
              <Ionicons color={colors.ink} name="git-network-outline" size={22} />
              <Text style={styles.cardTitle}>{source.name}</Text>
            </View>
            <View style={styles.connectedBadge}>
              <Text style={styles.connectedText}>已连接</Text>
            </View>
          </View>
          <Text numberOfLines={2} style={styles.description}>
            {source.description}
          </Text>
          <Text style={styles.metaText}>{source.connection}</Text>
          <Text style={styles.metaText}>最近上传 {source.uploadedAt}</Text>
        </View>
      ))}
    </>
  );
}

export function GroupScreen() {
  const [activeTab, setActiveTab] = useState<TabKey>('audio');

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.topBar}>
        <IconButton icon="menu" label="菜单" />
        <View style={styles.topActions}>
          <IconButton icon="search" label="搜索" />
          <IconButton icon="options-outline" label="设置筛选" />
        </View>
      </View>
      <Text style={styles.displayTitle}>分组名称</Text>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {tabs.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setActiveTab(tab.key)}
              style={styles.tab}
            >
              <Text style={[styles.tabText, active && styles.activeTabText]}>
                {tab.label}
              </Text>
              <View style={[styles.tabUnderline, active && styles.activeTabUnderline]} />
            </Pressable>
          );
        })}
      </View>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'audio' ? <AudioContent /> : null}
        {activeTab === 'knowledge' ? <KnowledgeContent /> : null}
        {activeTab === 'sources' ? <SourcesContent /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  topActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: {
    opacity: 0.48,
  },
  displayTitle: {
    color: colors.ink,
    fontSize: typeScale.display,
    fontWeight: '700',
    letterSpacing: -1.8,
    marginBottom: spacing.xl,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xxl,
  },
  tabs: {
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  tab: {
    alignItems: 'center',
    flex: 1,
    minHeight: 51,
    justifyContent: 'flex-end',
  },
  tabText: {
    color: colors.secondary,
    fontSize: typeScale.tab,
    fontWeight: '700',
    paddingBottom: 13,
  },
  activeTabText: {
    color: colors.ink,
  },
  tabUnderline: {
    backgroundColor: 'transparent',
    height: 2,
    width: '68%',
  },
  activeTabUnderline: {
    backgroundColor: colors.ink,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  sectionHeaderSolo: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: typeScale.section,
    fontWeight: '700',
  },
  filterButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
  },
  filterText: {
    color: colors.secondary,
    fontSize: typeScale.body,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
    padding: spacing.lg,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.035,
    shadowRadius: 5,
  },
  cardTitle: {
    color: colors.ink,
    flexShrink: 1,
    fontSize: typeScale.cardTitle,
    fontWeight: '700',
  },
  audioMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  metaText: {
    color: colors.muted,
    fontSize: typeScale.caption,
    lineHeight: 22,
  },
  statusText: {
    color: colors.ink,
    fontSize: typeScale.caption,
  },
  inlineStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sharedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sourceTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  connectedBadge: {
    backgroundColor: colors.successSurface,
    borderRadius: radii.sm,
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  connectedText: {
    color: colors.success,
    fontSize: typeScale.caption,
    fontWeight: '700',
  },
  description: {
    color: colors.muted,
    fontSize: typeScale.body,
    lineHeight: 24,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
});
