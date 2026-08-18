/** Connects block navigation and source-location actions to the file route. */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useNavigationLoading } from '../../../../../../components/NavigationLoadingProvider';
import { BlockDetailScreen } from '../../../../../../features/knowledge/BlockDetailScreen';

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
