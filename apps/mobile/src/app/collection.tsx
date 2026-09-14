/**
 * 知识收集与案例学习路由。
 *
 * 规范化分组、知识库、分析任务或案例定位并连接独立 feature 页面。
 *
 * Responsibilities:
 * - 保持导航绑定与页面业务状态分离。
 *
 * Notes:
 * - 不引入第二套导航系统。
 */
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import type { NavigationProp, ParamListBase } from 'expo-router/react-navigation';
import { CollectionGroupsScreen } from '@/features/knowledge-collection/CollectionGroupsScreen';
import { CollectionRulesScreen } from '@/features/knowledge-collection/CollectionRulesScreen';
import { CollectionCaptureScreen } from '@/features/knowledge-collection/CollectionCaptureScreen';
import { KnowledgeCasesScreen } from '@/features/knowledge-collection/KnowledgeCasesScreen';
import { KnowledgeCaseScreen } from '@/features/knowledge-collection/KnowledgeCaseScreen';
import { firstRouteParam } from '@/shared/navigation/routeParams';
import { backOrReplace } from '@/shared/navigation/routeBack';

/** 路由定位优先进入案例详情，其次分析收集、知识库列表和分组规则。 */
export default function CollectionRoute() {
  const router = useRouter();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const params = useLocalSearchParams<{
    defaultKnowledgeId?: string | string[];
    groupId?: string | string[];
    knowledgeId?: string | string[];
    jobId?: string | string[];
    tagId?: string | string[];
    caseId?: string | string[];
    correct?: string | string[];
    view?: string | string[];
    ruleId?: string | string[];
    edit?: string | string[];
  }>();
  const groupId = firstRouteParam(params.groupId);
  const defaultKnowledgeId = firstRouteParam(params.defaultKnowledgeId) || undefined;
  const knowledgeId = firstRouteParam(params.knowledgeId);
  const jobId = firstRouteParam(params.jobId);
  const caseId = firstRouteParam(params.caseId);
  const onBack = () => backOrReplace(router, '/');
  const onOpen = (id: string) => router.push({ pathname: '/collection', params: { caseId: id } });
  if (caseId)
    return (
      <KnowledgeCaseScreen
        caseId={caseId}
        onBack={onBack}
        initiallyEditing={firstRouteParam(params.edit) === 'true'}
        navigation={navigation}
      />
    );
  if (jobId)
    return (
      <CollectionCaptureScreen
        jobId={jobId}
        navigation={navigation}
        tagId={firstRouteParam(params.tagId) || undefined}
        correct={firstRouteParam(params.correct) === 'true'}
        onBack={onBack}
        onSaved={(id) => router.replace({ pathname: '/collection', params: { caseId: id } })}
      />
    );
  if (knowledgeId)
    return <KnowledgeCasesScreen knowledgeId={knowledgeId} onBack={onBack} onOpen={onOpen} />;
  if (!groupId)
    return (
      <CollectionGroupsScreen
        defaultKnowledgeId={defaultKnowledgeId}
        onBack={onBack}
        onSelect={(id) =>
          router.push({
            pathname: '/collection',
            params: { groupId: id, ...(defaultKnowledgeId ? { defaultKnowledgeId } : {}) },
          })
        }
      />
    );
  return (
    <CollectionRulesScreen
      key={`${groupId}:${firstRouteParam(params.view)}:${firstRouteParam(params.ruleId)}`}
      view={
        firstRouteParam(params.view) === 'rule'
          ? 'rule'
          : firstRouteParam(params.view) === 'history'
            ? 'history'
            : 'home'
      }
      ruleId={firstRouteParam(params.ruleId) || undefined}
      onOperation={(view, ruleId) =>
        router.push({
          pathname: '/collection',
          params: {
            groupId,
            view,
            ...(ruleId ? { ruleId } : {}),
            ...(defaultKnowledgeId ? { defaultKnowledgeId } : {}),
          },
        })
      }
      groupId={groupId}
      navigation={navigation}
      defaultKnowledgeId={defaultKnowledgeId}
      onBack={onBack}
      onSwitchGroup={() =>
        router.push({
          pathname: '/collection',
          params: defaultKnowledgeId ? { defaultKnowledgeId } : {},
        })
      }
    />
  );
}
