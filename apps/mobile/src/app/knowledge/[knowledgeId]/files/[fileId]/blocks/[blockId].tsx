/**
 * 文档块详情路由入口。
 *
 * 连接知识库、文档和文档块参数，并处理相邻块与原文定位导航。
 *
 * Responsibilities:
 * - 渲染指定文档块。
 * - 保持相邻块导航参数完整。
 *
 * Notes:
 * - 不在路由层缓存文档正文。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useNavigationLoading } from '../../../../../../components/NavigationLoadingProvider';
import { BlockDetailScreen } from '../../../../../../features/knowledge/BlockDetailScreen';

/** 渲染指定文档块并保留完整来源层级参数。 */
export default function BlockDetailRoute() {
  const router = useRouter();
  const { runWithLoading } = useNavigationLoading();
  const params = useLocalSearchParams<{
    blockId?: string | string[];
    fileId?: string | string[];
    knowledgeId?: string | string[];
  }>();
  const knowledgeId = first(params.knowledgeId);
  const documentId = first(params.fileId);
  const blockId = first(params.blockId);
  const fileRoute = {
    pathname: '/knowledge/[knowledgeId]/files/[fileId]' as const,
    params: { fileId: documentId, knowledgeId },
  };
  const goBack = () => {
    void runWithLoading(() => {
      router.replace(fileRoute);
    });
  };

  return (
    <BlockDetailScreen
      blockId={blockId}
      documentId={documentId}
      knowledgeId={knowledgeId}
      onBack={goBack}
      onLocateOriginal={(targetBlockId) => {
        void runWithLoading(() =>
          router.replace({
            pathname: fileRoute.pathname,
            params: { ...fileRoute.params, block: targetBlockId, tab: 'original' },
          }),
        );
      }}
      onNavigateBlock={(nextBlockId) => {
        void runWithLoading(() =>
          router.replace({
            pathname: '/knowledge/[knowledgeId]/files/[fileId]/blocks/[blockId]',
            params: {
              blockId: nextBlockId,
              fileId: documentId,
              knowledgeId,
            },
          }),
        );
      }}
    />
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}
