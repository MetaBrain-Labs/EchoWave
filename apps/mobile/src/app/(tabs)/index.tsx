/**
 * 分组标签路由入口。
 *
 * 将分组主页面与分析详情路由连接，保持页面组件不依赖 Expo Router 实现细节。
 *
 * Responsibilities:
 * - 渲染分组工作区。
 * - 把分析记录选择转换为路由跳转。
 *
 * Notes:
 * - 分组数据请求与状态由 feature 层负责。
 */
import { useRouter } from 'expo-router';

import { GroupScreen } from '@/features/group/GroupScreen';
import { useNavigationLoading } from '@/shared/navigation/NavigationLoadingProvider';

/** 连接分组页面与分析详情导航。 */
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
