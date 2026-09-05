/**
 * 服务状态详情路由。
 *
 * 绑定服务探测、服务器切换入口和返回导航，不持有跨页面业务状态。
 *
 * Responsibilities:
 * - 展示当前 EchoWave Server 的连接状态。
 * - 进入运行时服务器修改页面。
 *
 * Notes:
 * - 连接状态与地址由共享运行时配置层持有。
 */
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ServiceStatusCard } from '@/features/system-status/ServiceStatusCard';
import { colors, spacing } from '@/shared/theme/tokens';
import { PageHeader } from '@/shared/ui/PageHeader';

/** 渲染 API 服务状态、当前端点、重试和服务器切换操作。 */
export default function ServiceStatusRoute() {
  const router = useRouter();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <PageHeader onBack={() => router.back()} onMore={() => undefined} title="服务状态" />
      <ScrollView contentContainerStyle={styles.content}>
        <ServiceStatusCard onChangeServer={() => router.push('/server-connection')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  content: { padding: spacing.md },
});
