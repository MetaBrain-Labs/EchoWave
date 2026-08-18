/** Connects file-detail tabs and block links to Expo Router parameters. */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useNavigationLoading } from '../../../../components/NavigationLoadingProvider';
import { DocumentDetailScreen } from '../../../../features/knowledge/DocumentDetailScreen';

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
