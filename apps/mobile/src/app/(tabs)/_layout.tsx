/**
 * 底部标签路由布局。
 *
 * 定义 EchoWave 五个持久产品区域的路由、中文标签与图标，并保持跨平台导航行为一致。
 *
 * Responsibilities:
 * - 注册分组、知识库、新建、分析和更多标签页。
 * - 配置标签栏的可访问名称与视觉状态。
 *
 * Notes:
 * - 不承载各页面业务状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useNavigationLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { colors, radii } from '@/shared/theme/tokens';

/** 渲染五个固定产品区域的底部标签布局。 */
export default function TabsLayout() {
  const { runWithLoading } = useNavigationLoading();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.secondary,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabBarItem,
        tabBarButton: ({ accessibilityState, onPress, ref, ...props }) => (
          <Pressable
            {...props}
            accessibilityState={accessibilityState}
            android_ripple={undefined}
            onPress={(event) => {
              if (accessibilityState?.selected) {
                onPress?.(event);
                return;
              }
              void runWithLoading(() => onPress?.(event));
            }}
            ref={ref as ComponentProps<typeof Pressable>['ref']}
          />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '分组',
          tabBarAccessibilityLabel: '分组',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'albums' : 'albums-outline'} size={27} />
          ),
        }}
      />
      <Tabs.Screen
        name="knowledge"
        options={{
          title: '知识库',
          tabBarAccessibilityLabel: '知识库',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'book' : 'book-outline'} size={27} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: '新建',
          tabBarAccessibilityLabel: '新建',
          tabBarIcon: () => (
            <View style={styles.createButton}>
              <Ionicons color={colors.white} name="add" size={42} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="sources"
        options={{
          title: '数据源',
          tabBarAccessibilityLabel: '数据源',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              color={color}
              name={focused ? 'stats-chart' : 'stats-chart-outline'}
              size={27}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: '更多',
          tabBarAccessibilityLabel: '更多',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'grid' : 'grid-outline'} size={27} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.card,
    borderTopColor: colors.divider,
    height: 80,
    paddingBottom: 12,
    paddingTop: 8,
  },
  tabBarItem: {
    overflow: 'visible',
  },
  createButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.round,
    height: 72,
    justifyContent: 'center',
    marginTop: -32,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    width: 72,
  },
});
