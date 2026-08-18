/** Connects the Knowledge tab catalogue to its detail hierarchy. */
import { useRouter } from 'expo-router';

import { useNavigationLoading } from '../../components/NavigationLoadingProvider';
import { KnowledgeListScreen } from '../../features/knowledge/KnowledgeListScreen';

export default function KnowledgeScreen() {
  const router = useRouter();
  const { runWithLoading } = useNavigationLoading();

  return (
    <KnowledgeListScreen
      onOpenKnowledge={(knowledgeId) => {
        void runWithLoading(() =>
          router.push({
            pathname: '/knowledge/[knowledgeId]',
            params: { knowledgeId },
          }),
        );
      }}
    />
  );
}
