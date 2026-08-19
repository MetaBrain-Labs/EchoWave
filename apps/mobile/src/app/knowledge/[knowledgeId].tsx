/** Connects one knowledge base to files and linked groups outside the tab layout. */
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { useNavigationLoading } from '../../components/NavigationLoadingProvider';
import { KnowledgeDetailScreen } from '../../features/knowledge/KnowledgeDetailScreen';

export default function KnowledgeDetailRoute() {
  const router = useRouter();
  const { runWithLoading } = useNavigationLoading();
  const { knowledgeId } = useLocalSearchParams<{ knowledgeId?: string | string[] }>();
  const id = Array.isArray(knowledgeId) ? knowledgeId[0] : (knowledgeId ?? '');
  const goBack = () => {
    void runWithLoading(() => {
      router.replace('/knowledge');
    });
  };

  return (
    <KnowledgeDetailScreen
      knowledgeId={id}
      onBack={goBack}
      onAsk={() => {
        void runWithLoading(() =>
          router.push(`/knowledge/${id}/ask` as Href),
        );
      }}
      onOpenDocument={(documentId) => {
        void runWithLoading(() =>
          router.push({
            pathname: '/knowledge/[knowledgeId]/files/[fileId]',
            params: { fileId: documentId, knowledgeId: id },
          }),
        );
      }}
    />
  );
}
