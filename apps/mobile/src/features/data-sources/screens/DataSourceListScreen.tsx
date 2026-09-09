/**
 * 数据源列表页面。
 *
 * 展示服务端数据源摘要，并连接到数据源详情路由。
 *
 * Responsibilities:
 * - 呈现数据源名称、说明、连接方式、分组数和最近上传时间。
 * - 提供搜索、新建数据源和详情导航入口。
 *
 * Notes:
 * - 所有响应均由共享契约在客户端边界校验。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DataSourceSummary } from '@echowave/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import type { TranslationKey } from '@/shared/i18n/translations';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { SearchSheet } from '@/shared/ui/SearchSheet';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';

import { DataSourceFormSheet, type DataSourceFormValue } from '../components/DataSourceDialogs';

const connectionStatusLabelKeys: Record<DataSourceSummary['connectionStatus'], TranslationKey> = {
  connected: 'sources.connected',
  disconnected: 'sources.disconnected',
  error: 'sources.connectionError',
  disabled: 'sources.disabled',
};

const locationLabelKeys: Record<DataSourceSummary['location'], TranslationKey> = {
  local: 'sources.local',
  cloud: 'sources.cloud',
};

function DataSourceCard({ onOpen, source }: { onOpen: () => void; source: DataSourceSummary }) {
  const { formatDateTime, t } = useAppLanguage();
  return (
    <Pressable
      accessibilityHint={t('sources.openHint')}
      accessibilityLabel={t('sources.open', { name: source.name })}
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
          accessibilityLabel={
            source.location === 'local' ? t('sources.localSource') : t('sources.cloudSource')
          }
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
        {source.description || t('sources.noDescription')}
      </Text>
      <Text numberOfLines={1} style={styles.metaText}>
        {t('sources.linkedGroups', {
          count: source.linkedGroupCount,
          connection: source.connectionLabel,
        })}
      </Text>
      <Text style={styles.uploadedAt}>
        {t('sources.lastUpload', {
          date: source.lastUploadedAt ? formatDateTime(source.lastUploadedAt) : t('sources.none'),
        })}
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
  const { t } = useAppLanguage();
  const headerTourRef = useStarterTourTarget('data-sources-header');
  const createTourRef = useStarterTourTarget('data-sources-create');
  const [dataSources, setDataSources] = useState<DataSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formVisible, setFormVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const runInitialRequest = useInitialRequestLoading();
  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError('');
      try {
        setDataSources((await listDataSources()).items);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('sources.loadFailed'));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [t],
  );
  const screenRefresh = useScreenRefresh(() => load(false));
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
      setFormError(reason instanceof Error ? reason.message : t('sources.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const visibleDataSources = useMemo(() => {
    const normalized = searchQuery.trim().toLocaleLowerCase();
    if (!normalized) return dataSources;
    return dataSources.filter((source) =>
      [
        source.name,
        source.description,
        source.connectionLabel,
        t(connectionStatusLabelKeys[source.connectionStatus]),
        t(locationLabelKeys[source.location]),
      ].some((value) => value.toLocaleLowerCase().includes(normalized)),
    );
  }, [dataSources, searchQuery, t]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      {searchVisible ? (
        <SearchSheet
          appliedQuery={searchQuery}
          inputLabel={t('sources.searchInput')}
          onApply={(query) => {
            setSearchQuery(query);
            setSearchVisible(false);
          }}
          onClose={() => setSearchVisible(false)}
          placeholder={t('sources.searchPlaceholder')}
          title={t('sources.searchTitle')}
          visible
        />
      ) : null}
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
      <View collapsable={false} ref={headerTourRef}>
        <TopLevelPageHeader
          actions={[
            {
              accessibilityLabel: t('sources.search'),
              icon: 'search-outline',
              onPress: () => setSearchVisible(true),
            },
            {
              accessibilityLabel: t('sources.create'),
              icon: 'add',
              label: t('sources.createShort'),
              onPress: () => {
                setFormError('');
                setFormVisible(true);
              },
              targetRef: createTourRef,
              testID: 'e2e-new-data-source',
            },
          ]}
          title={t('sources.title')}
        />
      </View>
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.content}
        refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        showsVerticalScrollIndicator={false}
        testID="data-source-list-scroll"
      >
        <View style={styles.list}>
          {loading ? (
            <ActivityIndicator accessibilityLabel={t('sources.loading')} color={colors.ink} />
          ) : null}
          {error ? (
            <View style={styles.errorCard}>
              <Text accessibilityRole="alert" style={styles.description}>
                {error}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void load()}>
                <Text style={styles.retryText}>{t('sources.reload')}</Text>
              </Pressable>
            </View>
          ) : null}
          {!loading && !error && dataSources.length === 0 ? (
            <Text style={styles.description}>{t('sources.empty')}</Text>
          ) : null}
          {!loading && !error && dataSources.length > 0 && visibleDataSources.length === 0 ? (
            <Text style={styles.description}>{t('sources.noMatch', { query: searchQuery })}</Text>
          ) : null}
          {!loading && !error
            ? visibleDataSources.map((source) => (
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
  list: {
    gap: spacing.sm,
  },
  errorCard: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
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
    padding: spacing.md,
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
