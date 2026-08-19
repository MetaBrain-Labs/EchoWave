/** Connects ephemeral RAG chat and citation links to Expo Router. */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { KnowledgeQueryScreen } from '../../../features/knowledge/KnowledgeQueryScreen';

export default function KnowledgeQueryRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ knowledgeId?: string | string[] }>();
  const knowledgeId = Array.isArray(params.knowledgeId) ? (params.knowledgeId[0] ?? '') : (params.knowledgeId ?? '');
  return (
    <KnowledgeQueryScreen
      knowledgeId={knowledgeId}
      onBack={() => router.replace({ pathname: '/knowledge/[knowledgeId]', params: { knowledgeId } })}
      onOpenCitation={(documentId, chunkId) => router.push({
        pathname: '/knowledge/[knowledgeId]/files/[fileId]/blocks/[blockId]',
        params: { knowledgeId, fileId: documentId, blockId: chunkId },
      })}
    />
  );
}
