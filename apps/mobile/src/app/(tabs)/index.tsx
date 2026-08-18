import { useRouter } from 'expo-router';

import { useNavigationLoading } from '../../components/NavigationLoadingProvider';
import { GroupScreen } from '../../features/group/GroupScreen';

export default function GroupRoute() {
  const router = useRouter();
  const { runWithLoading } = useNavigationLoading();

  return (
    <GroupScreen
      onOpenAudio={(id) => {
        void runWithLoading(() =>
          router.push({ pathname: '/analysis/[id]', params: { id } }),
        );
      }}
    />
  );
}
