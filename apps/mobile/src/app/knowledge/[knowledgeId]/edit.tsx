/**
 * 知识库全屏编辑路由入口。
 *
 * 负责读取知识库详情并连接编辑页、类别管理页及返回导航，页面本身不承载业务持久化逻辑。
 *
 * Responsibilities:
 * - 规范化知识库、来源和分组路由参数。
 * - 在独立全屏页面中编辑知识库名称与默认类别。
 *
 * Notes:
 * - 保存仍调用现有知识库 API，返回后由详情页继续展示知识库内容。
 */
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getKnowledgeBase } from '@/features/knowledge/apiClient';
import { KnowledgeBaseEditScreen } from '@/features/knowledge/screens/KnowledgeBaseEditScreen';
import { colors, spacing, textColors, typography } from '@/shared/theme/tokens';
import { parseResourceOrigin } from '@/shared/navigation/resourceOrigin';
import { backOrReplace } from '@/shared/navigation/routeBack';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 渲染知识库全屏编辑页并连接类别管理导航。 */
export default function KnowledgeBaseEditRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    groupId?: string | string[];
    guideDemo?: string | string[];
    knowledgeId?: string | string[];
    origin?: string | string[];
  }>();
  const knowledgeId = firstRouteParam(params.knowledgeId);
  const groupId = firstRouteParam(params.groupId);
  const origin = parseResourceOrigin(params.origin);
  const [knowledge, setKnowledge] = useState<Awaited<ReturnType<typeof getKnowledgeBase>>>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setKnowledge(await getKnowledgeBase(knowledgeId));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '知识库加载失败。');
    }
  }, [knowledgeId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const goBack = () => {
    backOrReplace(router, {
      pathname: '/knowledge/[knowledgeId]',
      params: {
        knowledgeId,
        ...(origin ? { origin } : {}),
        ...(groupId ? { groupId } : {}),
      },
    });
  };

  if (!knowledge) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.loadingScreen}>
        <ActivityIndicator color={colors.primary} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </SafeAreaView>
    );
  }

  return (
    <KnowledgeBaseEditScreen
      knowledge={knowledge}
      onBack={goBack}
      onManageCategories={() =>
        router.push({
          pathname: '/knowledge/[knowledgeId]/categories',
          params: {
            knowledgeId,
            ...(origin ? { origin } : {}),
            ...(groupId ? { groupId } : {}),
          },
        } as unknown as Href)
      }
      onSaved={() => undefined}
    />
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
  },
  error: { ...typography.description, color: textColors.secondary },
});
