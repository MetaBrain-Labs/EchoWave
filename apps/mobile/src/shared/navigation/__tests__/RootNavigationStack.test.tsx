/**
 * 根原生导航栈测试。
 *
 * 验证应用根布局使用 Stack 承载标签页和详情页，使系统侧滑能够弹出真实父页面。
 *
 * Responsibilities:
 * - 锁定根布局不再使用只负责占位渲染的 Slot。
 * - 保持应用自定义页头关闭，避免出现重复导航栏。
 *
 * Notes:
 * - 字体和导航器使用同步替身，不启动真实原生容器。
 */
import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import RootLayout from '../../../app/_layout';

jest.mock('expo-font', () => ({
  useFonts: () => [true, undefined],
}));

jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    Stack: ({ screenOptions }: { screenOptions: { headerShown: boolean } }) =>
      React.createElement(View, {
        accessibilityLabel: JSON.stringify(screenOptions),
        testID: 'root-native-stack',
      }),
    useRouter: () => ({ push: jest.fn() }),
  };
});

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
  getLastNotificationResponseAsync: async () => null,
  getPermissionsAsync: async () => ({ status: 'denied' }),
  requestPermissionsAsync: async () => ({ status: 'denied' }),
  setNotificationChannelAsync: async () => undefined,
  setNotificationHandler: jest.fn(),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  return {
    SafeAreaProvider: ({ children }: { children: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

jest.mock('@/shared/api/ServerConnectionProvider', () => ({
  ServerConnectionProvider: ({ children }: { children: ReactNode }) => children,
  useServerConnection: () => ({
    error: null,
    phase: 'ready',
    revision: 0,
    serverUrl: 'http://localhost:3001',
  }),
}));

jest.mock('@/shared/api/serverHealth', () => ({
  fetchServerHealth: async () => ({
    name: 'EchoWave',
    service: 'echowave-api',
    version: '0.1.0',
    apiVersion: 1,
    status: 'ok',
    capabilities: { remotePush: false },
  }),
}));

jest.mock('@/shared/notifications/PushNotificationProvider', () => ({
  PushNotificationProvider: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/shared/navigation/NavigationLoadingProvider', () => ({
  NavigationLoadingProvider: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/shared/onboarding/StarterTourProvider', () => ({
  StarterTourProvider: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/shared/ui/StatusBarBackdrop', () => ({
  StatusBarBackdrop: () => null,
}));

describe('Root navigation stack', () => {
  it('uses a headerless native Stack so gesture back preserves the previous tab scene', async () => {
    const screen = render(<RootLayout />);

    expect(await screen.findByTestId('root-native-stack')).toBeTruthy();
    expect(screen.getByLabelText(JSON.stringify({ headerShown: false }))).toBeTruthy();
  });
});
