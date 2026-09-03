/**
 * 服务状态详情路由。
 *
 * 将原“更多”页内嵌的连接诊断卡片移动到独立详情页。
 */
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ServiceStatusCard } from '@/features/system-status/ServiceStatusCard';
import { colors, spacing } from '@/shared/theme/tokens';
import { PageHeader } from '@/shared/ui/PageHeader';

/** 渲染 API 服务状态、端点和重试操作。 */
export default function ServiceStatusRoute() {
  const router = useRouter();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <PageHeader onBack={() => router.back()} onMore={() => undefined} title="服务状态" />
      <ScrollView contentContainerStyle={styles.content}>
        <ServiceStatusCard />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  content: { padding: spacing.md },
});
