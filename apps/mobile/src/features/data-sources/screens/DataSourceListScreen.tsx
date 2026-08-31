/**
 * 数据源列表页面。
 *
 * 展示服务端数据源摘要，并连接到数据源详情路由。
 *
 * Responsibilities:
 * - 呈现数据源名称、说明、连接方式、分组数和最近上传时间。
 * - 提供搜索、新增数据源和详情导航入口。
 *
 * Notes:
 * - 所有响应均由共享契约在客户端边界校验。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DataSourceSummary } from '@echowave/contracts';
import { useCallback, useEffect, useState } from 'react';
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

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { createDataSource, listDataSources } from '@/shared/api/dataSourcesApi';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';

import { DataSourceFormSheet, type DataSourceFormValue } from '../components/DataSourceDialogs';

function showComingSoon(feature: string) {
  Alert.alert('功能建设中', `${feature}将在后续版本开放。`);
}

function DataSourceCard({ onOpen, source }: { onOpen: () => void; source: DataSourceSummary }) {
  return (
    <Pressable
      accessibilityHint="打开该数据源的详情"
      accessibilityLabel={`打开数据源：${source.name}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed && styles.pressedCard]}
    >
      <View style={styles.cardTitleRow}>
        <View style={styles.cardTitleMain}>
          <Ionicons
            color={colors.ink}
            name="git-network-outline"
            size={typography.heading2.lineHeight}
          />
          <Text numberOfLines={1} style={styles.cardTitle}>
            {source.name}
          </Text>
        </View>
        <View
          accessibilityLabel={source.location === 'local' ? '本地来源' : '云端来源'}
          style={styles.locationIcon}
        >
          <Ionicons
            color={colors.ink}
            name={source.location === 'local' ? 'folder-outline' : 'cloud-outline'}
            size={typography.heading2.lineHeight}
          />
        </View>
      </View>
      <Text numberOfLines={2} style={styles.description}>
        {source.description || '暂无描述'}
      </Text>
      <Text numberOfLines={1} style={styles.metaText}>
        接入 {source.linkedGroupCount} 个分组 · {source.connectionLabel}
      </Text>
      <Text style={styles.uploadedAt}>
        最近上传　
        {source.lastUploadedAt ? new Date(source.lastUploadedAt).toLocaleString() : '暂无'}
      </Text>
    </Pressable>
  );
}

/** 渲染数据源目录并把选中项交给路由层处理。 */
export function DataSourceListScreen({
  onOpenSource,
}: {
  onOpenSource: (sourceId: string) => void;
}) {
  const [dataSources, setDataSources] = useState<DataSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formVisible, setFormVisible] = useState(false);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const runInitialRequest = useInitialRequestLoading();
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDataSources((await listDataSources()).items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '数据源加载失败。');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const task = setTimeout(() => void runInitialRequest(load), 0);
    return () => clearTimeout(task);
  }, [load, runInitialRequest]);

  const create = async (value: DataSourceFormValue) => {
    setCreating(true);
    setFormError('');
    try {
      const created = await createDataSource(value);
      setDataSources((items) => [created, ...items]);
      setFormVisible(false);
      onOpenSource(created.id);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '数据源创建失败。');
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <DataSourceFormSheet
        error={formError}
        initialValue={{ name: '', description: '' }}
        mode="create"
        onClose={() => {
          if (!creating) setFormVisible(false);
        }}
        onSubmit={(value) => {
          void create(value);
        }}
        pending={creating}
        visible={formVisible}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        testID="data-source-list-scroll"
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.pageTitle}>
            数据源
          </Text>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="搜索数据源"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => showComingSoon('数据源搜索')}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Ionicons color={colors.ink} name="search-outline" size={30} />
            </Pressable>
            <Pressable
              accessibilityLabel="新增数据源"
              accessibilityRole="button"
              onPress={() => {
                setFormError('');
                setFormVisible(true);
              }}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
            >
              <Ionicons color={colors.ink} name="add" size={typography.heading3.lineHeight} />
              <Text style={styles.addButtonText}>新增</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.list}>
          {loading ? (
            <ActivityIndicator accessibilityLabel="正在加载数据源" color={colors.ink} />
          ) : null}
          {error ? (
            <View style={styles.errorCard}>
              <Text accessibilityRole="alert" style={styles.description}>
                {error}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void load()}>
                <Text style={styles.retryText}>重新加载</Text>
              </Pressable>
            </View>
          ) : null}
          {!loading && !error && dataSources.length === 0 ? (
            <Text style={styles.description}>暂无数据源。</Text>
          ) : null}
          {!loading && !error
            ? dataSources.map((source) => (
                <DataSourceCard
                  key={source.id}
                  onOpen={() => onOpenSource(source.id)}
                  source={source}
                />
              ))
            : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 112,
  },
  pageTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.ink,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  addButtonText: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  pressed: {
    backgroundColor: colors.divider,
    borderRadius: radii.default,
  },
  list: {
    gap: spacing.sm,
  },
  errorCard: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    padding: spacing.lg,
  },
  retryText: {
    ...typography.heading5,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 188,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.035,
    shadowRadius: 5,
  },
  pressedCard: {
    backgroundColor: colors.background,
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitleMain: {
    alignItems: 'center',
    flex: 1,
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
  locationIcon: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    height: 36,
    justifyContent: 'center',
    marginLeft: spacing.sm,
    width: 36,
  },
  description: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.lg,
    minHeight: 40,
  },
  metaText: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.md,
  },
  uploadedAt: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
});
