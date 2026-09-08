/**
 * 多引导 Provider 测试。
 *
 * 验证基础引导自动播放、旧状态迁移、六项独立启动及完成和跳过持久化。
 *
 * Responsibilities:
 * - 锁定设备与 Server URL 隔离的状态模型。
 * - 确保只有基础引导会自动出现。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useEffect, type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';

import {
  StarterTourProvider,
  guideStorageKey,
  legacyStarterTourStorageKey,
  useStarterTour,
} from '../StarterTourProvider';
import { GUIDE_IDS, GUIDE_REGISTRY, type GuideId } from '../guideRegistry';
import type { GroupSummary } from '@echowave/contracts';
import { groupFixture } from '@/test/workspaceFixtures';

const serverUrl = 'http://192.168.1.8:3001';
const mockReplace = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

const templates: GroupSummary[] = [
  {
    ...groupFixture,
    id: '10000000-0000-4000-8000-000000000011',
    starterTemplateKey: 'sales_call_review',
  },
  {
    ...groupFixture,
    id: '10000000-0000-4000-8000-000000000012',
    name: '个人表达教练',
    starterTemplateKey: 'personal_speaking_coach',
  },
];

function Controls({ groups = templates }: { groups?: readonly GroupSummary[] }) {
  const { offerStarterTemplates, startGuide, statuses } = useStarterTour();
  useEffect(() => offerStarterTemplates(groups), [groups, offerStarterTemplates]);
  return (
    <>
      {GUIDE_IDS.map((id) => (
        <Pressable accessibilityLabel={`开始-${id}`} key={id} onPress={() => startGuide(id)}>
          <Text>{statuses[id]}</Text>
        </Pressable>
      ))}
    </>
  );
}

function renderTour(children: ReactNode = <Controls />) {
  return render(<StarterTourProvider serverUrl={serverUrl}>{children}</StarterTourProvider>);
}

describe('StarterTourProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
  });

  it('automatically runs and completes only the basic guide when templates are ready', async () => {
    const screen = renderTour();
    expect(await screen.findByText('欢迎使用 EchoWave')).toBeTruthy();
    expect(screen.getByTestId('starter-tour-state-ready')).toBeTruthy();
    expect(screen.getByTestId('starter-tour-overlay')).toBeTruthy();
    expect(screen.getByTestId('starter-tour-skip')).toBeTruthy();
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/',
      params: { groupId: templates[0].id },
    });
    for (let index = 0; index < GUIDE_REGISTRY.basic.steps.length - 1; index += 1) {
      fireEvent.press(screen.getByTestId('starter-tour-next'));
    }
    fireEvent.press(screen.getByTestId('starter-tour-finish'));
    await waitFor(() =>
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        guideStorageKey(serverUrl),
        expect.stringContaining('"basic":"completed"'),
      ),
    );
    expect(screen.getByTestId('starter-tour-state-ready')).toBeTruthy();
    expect(screen.queryByText('上传第一段录音')).toBeNull();
  });

  it('migrates the old completed flag into the basic status without auto-playing', async () => {
    jest
      .mocked(AsyncStorage.getItem)
      .mockImplementation(async (key) =>
        key === legacyStarterTourStorageKey(serverUrl) ? 'completed' : null,
      );
    const screen = renderTour();
    await waitFor(() =>
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        guideStorageKey(serverUrl),
        expect.stringContaining('"basic":"completed"'),
      ),
    );
    expect(screen.getByTestId('starter-tour-state-ready')).toBeTruthy();
    expect(screen.queryByText('欢迎使用 EchoWave')).toBeNull();
  });

  it.each(GUIDE_IDS.filter((id) => id !== 'basic'))(
    'starts %s only when requested and records a skip',
    async (id: GuideId) => {
      const saved = {
        statuses: Object.fromEntries(
          GUIDE_IDS.map((key) => [key, key === 'basic' ? 'completed' : 'not_started']),
        ),
      };
      jest
        .mocked(AsyncStorage.getItem)
        .mockImplementation(async (key) =>
          key === guideStorageKey(serverUrl) ? JSON.stringify(saved) : null,
        );
      const screen = renderTour();
      await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
      expect(screen.queryByText(GUIDE_REGISTRY[id].steps[0].title)).toBeNull();
      fireEvent.press(screen.getByLabelText(`开始-${id}`));
      expect(await screen.findByText(GUIDE_REGISTRY[id].steps[0].title)).toBeTruthy();
      fireEvent.press(screen.getByLabelText('跳过当前引导'));
      await waitFor(() =>
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
          guideStorageKey(serverUrl),
          expect.stringContaining(`"${id}":"skipped"`),
        ),
      );
    },
  );

  it('does not auto-start when one starter template is unavailable', async () => {
    const screen = renderTour(<Controls groups={[templates[0]]} />);
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
    expect(screen.queryByTestId('starter-tour-state-ready')).toBeNull();
    expect(screen.queryByText('欢迎使用 EchoWave')).toBeNull();
  });
});
