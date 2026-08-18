import { useRouter } from 'expo-router';

import { GroupScreen } from '../../features/group/GroupScreen';

export default function GroupRoute() {
  const router = useRouter();

  return (
    <GroupScreen
      onOpenAudio={(id) =>
        router.push({ pathname: '/analysis/[id]', params: { id } })
      }
    />
  );
}
