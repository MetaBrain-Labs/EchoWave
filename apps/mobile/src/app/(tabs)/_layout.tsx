/** Defines the five persistent product areas shown in the supplied navigation sketch. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '../../theme/tokens';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.secondary,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabBarItem,
        tabBarButton: ({ ref, ...props }) => (
          <Pressable
            {...props}
            android_ripple={undefined}
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
            <Ionicons
              color={color}
              name={focused ? 'albums' : 'albums-outline'}
              size={27}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="knowledge"
        options={{
          title: '知识库',
          tabBarAccessibilityLabel: '知识库',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              color={color}
              name={focused ? 'book' : 'book-outline'}
              size={27}
            />
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
        name="analysis"
        options={{
          title: '分析',
          tabBarAccessibilityLabel: '分析',
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
            <Ionicons
              color={color}
              name={focused ? 'grid' : 'grid-outline'}
              size={27}
            />
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
    paddingTop: 10,
  },
  tabBarItem: {
    overflow: 'visible',
  },
  createButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    marginTop: -30,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    width: 72,
  },
});
