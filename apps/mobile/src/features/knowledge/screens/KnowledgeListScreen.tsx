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
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { SearchSheet } from '@/shared/ui/SearchSheet';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';
import { useStarterTour, useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { createKnowledgeBase, listKnowledgeBases } from '../apiClient';

/** 展示创建知识库时由服务端默认值锁定的配置项。 */
function ReadonlySetting({ label, value }: { label: string; value: string }) {
  const { t } = useAppLanguage();
  return (
    <View
      accessibilityLabel={t('knowledge.readonly', { label, value })}
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
  const { formatDateTime, t } = useAppLanguage();
  const { activeStep } = useStarterTour();
  const headerTourRef = useStarterTourTarget('knowledge-header');
  const createTourRef = useStarterTourTarget('knowledge-create');
  const formTourRef = useStarterTourTarget('knowledge-form');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const runInitialRequest = useInitialRequestLoading();
  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError('');
      try {
        setKnowledgeBases((await listKnowledgeBases()).items);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('knowledge.loadFailed'));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [t],
  );
  const screenRefresh = useScreenRefresh(() => load(false));
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
      setError(reason instanceof Error ? reason.message : t('knowledge.createFailed'));
    } finally {
      setCreating(false);
    }
  };
  useEffect(() => {
    const task = setTimeout(() => void runInitialRequest(load), 0);
    return () => clearTimeout(task);
  }, [load, runInitialRequest]);
  useEffect(() => {
    if (activeStep !== 'knowledge-form') return undefined;
    const task = setTimeout(() => setShowCreate(true), 0);
    return () => clearTimeout(task);
  }, [activeStep]);

  const visibleKnowledgeBases = useMemo(() => {
    const normalized = searchQuery.trim().toLocaleLowerCase();
    if (!normalized) return knowledgeBases;
    return knowledgeBases.filter((item) =>
      [item.name, item.description].some((value) => value.toLocaleLowerCase().includes(normalized)),
    );
  }, [knowledgeBases, searchQuery]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      {searchVisible ? (
        <SearchSheet
          appliedQuery={searchQuery}
          inputLabel={t('knowledge.searchInput')}
          onApply={(query) => {
            setSearchQuery(query);
            setSearchVisible(false);
          }}
          onClose={() => setSearchVisible(false)}
          placeholder={t('knowledge.searchPlaceholder')}
          title={t('knowledge.searchTitle')}
          visible
        />
      ) : null}
      <View collapsable={false} ref={headerTourRef}>
        <TopLevelPageHeader
          actions={[
            {
              accessibilityLabel: t('knowledge.searchTitle'),
              icon: 'search-outline',
              onPress: () => setSearchVisible(true),
            },
            {
              accessibilityLabel: t('knowledge.create'),
              disabled: loading || creating,
              icon: 'add',
              label: t('knowledge.createShort'),
              onPress: () => setShowCreate((current) => !current),
              targetRef: createTourRef,
              testID: 'e2e-new-knowledge-base',
            },
          ]}
          title={t('knowledge.title')}
        />
      </View>

      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.listContent}
        refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        showsVerticalScrollIndicator={false}
        testID="knowledge-list-scroll"
      >
        {showCreate ? (
          <View
            accessibilityLabel={t('knowledge.createForm')}
            collapsable={false}
            ref={formTourRef}
            style={styles.createPanel}
          >
            <TextInput
              accessibilityLabel={t('knowledge.name')}
              maxLength={120}
              onChangeText={setCreateName}
              placeholder={t('knowledge.name')}
              style={styles.input}
              value={createName}
            />
            <TextInput
              accessibilityLabel={t('knowledge.description')}
              maxLength={1000}
              multiline
              onChangeText={setCreateDescription}
              placeholder={t('knowledge.descriptionOptional')}
              style={[styles.input, styles.descriptionInput]}
              value={createDescription}
            />
            <View style={styles.settingsSection}>
              <Text style={styles.settingsTitle}>{t('knowledge.contentStorage')}</Text>
              <ReadonlySetting
                label={t('knowledge.storageLocation')}
                value={t('knowledge.local')}
              />
            </View>
            <View style={styles.settingsSection}>
              <Text style={styles.settingsTitle}>{t('knowledge.parsing')}</Text>
              <ReadonlySetting label={t('knowledge.indexMethod')} value={t('knowledge.rag')} />
              <ReadonlySetting
                label={t('knowledge.embeddingModel')}
                value="qwen3.7-text-embedding"
              />
              <ReadonlySetting label={t('knowledge.rerankModel')} value={t('knowledge.disabled')} />
            </View>
            <View style={styles.settingsSection}>
              <Text style={styles.settingsTitle}>{t('knowledge.processing')}</Text>
              <ReadonlySetting
                label={t('knowledge.parsingMethod')}
                value={t('knowledge.autoParse')}
              />
            </View>
            <View style={styles.createActions}>
              <Pressable accessibilityRole="button" onPress={() => setShowCreate(false)}>
                <Text style={styles.retry}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!createName.trim() || creating}
                onPress={() => void create()}
                style={[styles.submitButton, (!createName.trim() || creating) && styles.disabled]}
              >
                <Text style={styles.createText}>
                  {creating ? t('knowledge.creating') : t('knowledge.createOpen')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {loading ? (
          <ActivityIndicator accessibilityLabel={t('knowledge.loading')} color={colors.ink} />
        ) : null}
        {error ? (
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.feedback}>
            <Text style={styles.description}>{error}</Text>
            <Text style={styles.retry}>{t('knowledge.tapRetry')}</Text>
          </Pressable>
        ) : null}
        {!loading && !error && knowledgeBases.length === 0 ? (
          <Text style={styles.description}>{t('knowledge.empty')}</Text>
        ) : null}
        {!loading && !error && knowledgeBases.length > 0 && visibleKnowledgeBases.length === 0 ? (
          <Text style={styles.description}>{t('knowledge.noMatch', { query: searchQuery })}</Text>
        ) : null}
        {visibleKnowledgeBases.map((knowledge) => (
          <Pressable
            key={knowledge.id}
            accessibilityLabel={t('knowledge.open', { name: knowledge.name })}
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
              {knowledge.description || t('knowledge.noDescription')}
            </Text>
            <Text style={styles.meta}>
              {t('knowledge.counts', {
                documents: knowledge.documentCount,
                groups: knowledge.linkedGroupCount,
              })}
            </Text>
            <Text style={styles.updated}>
              {t('knowledge.updated', { date: formatDateTime(knowledge.updatedAt) })}
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
  createText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
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
