/** Connects the analysis-detail presentation screen to Expo Router navigation. */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useNavigationLoading } from '../../components/NavigationLoadingProvider';
import { AnalysisDetailScreen } from '../../features/analysis-detail/AnalysisDetailScreen';

export default function AnalysisDetailRoute() {
  const router = useRouter();
  const { runWithLoading } = useNavigationLoading();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const detailId = Array.isArray(id) ? id[0] : (id ?? '');
  const goBack = () => {
    void runWithLoading(() => {
      router.replace('/');
    });
  };

  return <AnalysisDetailScreen detailId={detailId} onBack={goBack} />;
}
