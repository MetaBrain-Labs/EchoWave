/**
 * 知识文档详情路由入口。
 *
 * 读取知识库和文档参数，连接文档详情标签与文档块导航。
 *
 * Responsibilities:
 * - 传递文档层级参数。
 * - 将文档块选择转换为详情路由。
 *
 * Notes:
 * - 文档内容以服务器响应为准。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useNavigationLoading } from '../../../../components/NavigationLoadingProvider';
import { DocumentDetailScreen } from '../../../../features/knowledge/DocumentDetailScreen';

/** 渲染指定知识文档并连接文档块详情导航。 */
export default function DocumentDetailRoute() {
  const router = useRouter();
  const { runWithLoading } = useNavigationLoading();
  const params = useLocalSearchParams<{
    block?: string | string[];
    fileId?: string | string[];
    knowledgeId?: string | string[];
    tab?: string | string[];
  }>();
  const knowledgeId = first(params.knowledgeId);
  const documentId = first(params.fileId);
  const blockId = first(params.block);
  const initialTab = first(params.tab) === 'original' ? 'original' : 'parsed';
  const goBack = () => {
    void runWithLoading(() => {
      router.replace({
        pathname: '/knowledge/[knowledgeId]',
        params: { knowledgeId },
      });
    });
  };

  return (
    <DocumentDetailScreen
      documentId={documentId}
      initialBlockId={blockId || undefined}
      initialTab={initialTab}
      knowledgeId={knowledgeId}
      onBack={goBack}
      onOpenBlock={(nextBlockId) => {
        void runWithLoading(() =>
          router.push({
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
