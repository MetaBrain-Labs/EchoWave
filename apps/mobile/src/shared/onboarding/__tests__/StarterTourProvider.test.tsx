/**
 * 多引导 Provider 测试。
 *
 * 验证基础引导自动播放、旧状态迁移、九项独立启动以及说明与目标坐标对应。
 *
 * Responsibilities:
 * - 锁定设备与 Server URL 隔离的状态模型。
 * - 确保只有基础引导会自动出现。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useEffect, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, type View } from 'react-native';

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
      {/* 模拟功能页顶部栏：带来源页启动引导。 */}
      <Pressable
        accessibilityLabel="从功能页开始"
        onPress={() => startGuide('runtime_mode', '/audio-runtime')}
      >
        <Text>从功能页开始</Text>
      </Pressable>
    </>
  );
}

function renderTour(children: ReactNode = <Controls />) {
  return render(<StarterTourProvider serverUrl={serverUrl}>{children}</StarterTourProvider>);
}

/** 使用不同尺寸与位置模拟按钮、标签页和表单块，检测跨步骤错误复用矩形。 */
function MeasuredTargets() {
  const { registerTarget } = useStarterTour();
  useEffect(() => {
    const samples = [
      ['group-settings', 300, 70, 44, 44],
      ['group-tabs', 0, 190, 360, 44],
      ['create-source', 16, 150, 328, 130],
      ['create-group', 16, 310, 328, 110],
    ] as const;
    for (const [key, x, y, width, height] of samples) {
      registerTarget(key, {
        measureInWindow: (
          callback: (x: number, y: number, width: number, height: number) => void,
        ) => callback(x, y, width, height),
      } as unknown as View);
    }
    return () => {
      for (const [key] of samples) registerTarget(key, null);
    };
  }, [registerTarget]);
  return null;
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
    expect(mockReplace).toHaveBeenLastCalledWith('/guides');
  });

  it('returns to the feature page when the guide was started from its top bar', async () => {
    // 基础引导已结束，避免自动播放抢占步骤。
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

    fireEvent.press(screen.getByLabelText('从功能页开始'));
    const steps = GUIDE_REGISTRY.runtime_mode.steps.length;
    for (let index = 0; index < steps - 1; index += 1) {
      fireEvent.press(await screen.findByTestId('starter-tour-next'));
    }
    fireEvent.press(await screen.findByTestId('starter-tour-finish'));

    // 从功能页发起的引导回到来源页，而不是引导中心。
    expect(mockReplace).toHaveBeenLastCalledWith('/audio-runtime');
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
      expect(screen.UNSAFE_getByType(Modal).props.statusBarTranslucent).not.toBe(true);
      fireEvent.press(screen.getByLabelText('跳过当前引导'));
      await waitFor(() =>
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
          guideStorageKey(serverUrl),
          expect.stringContaining(`"${id}":"skipped"`),
        ),
      );
      expect(mockReplace).toHaveBeenLastCalledWith('/guides');
    },
  );

  it('does not auto-start when one starter template is unavailable', async () => {
    const screen = renderTour(<Controls groups={[templates[0]]} />);
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
    expect(screen.queryByTestId('starter-tour-state-ready')).toBeNull();
    expect(screen.queryByText('欢迎使用 EchoWave')).toBeNull();
  });

  it('uses the correct button and form rectangles for the captions in the screenshots', async () => {
    const screen = renderTour(
      <>
        <Controls />
        <MeasuredTargets />
      </>,
    );
    await screen.findByText('欢迎使用 EchoWave');
    expect(screen.UNSAFE_getByType(Modal).props.statusBarTranslucent).not.toBe(true);
    for (let index = 0; index < 5; index += 1) {
      fireEvent.press(screen.getByTestId('starter-tour-next'));
    }
    expect(screen.getByText('按目标调整')).toBeTruthy();
    // 高亮框是说明卡旁的装饰层，不属于卡片的模态无障碍区域。
    await waitFor(() =>
      expect(
        StyleSheet.flatten(
          screen.getByTestId('starter-tour-spotlight', { includeHiddenElements: true }).props.style,
        ),
      ).toEqual(expect.objectContaining({ left: 293, top: 63, width: 58, height: 58 })),
    );
    fireEvent.press(screen.getByTestId('starter-tour-next'));
    expect(screen.getByText('选择数据源')).toBeTruthy();
    expect(mockReplace).toHaveBeenLastCalledWith('/analysis-create');
    await waitFor(() =>
      expect(
        StyleSheet.flatten(
          screen.getByTestId('starter-tour-spotlight', { includeHiddenElements: true }).props.style,
        ),
      ).toEqual(expect.objectContaining({ left: 9, top: 143, width: 342, height: 144 })),
    );
    fireEvent.press(screen.getByTestId('starter-tour-next'));
    expect(screen.getByText('选择模板分组')).toBeTruthy();
    await waitFor(() =>
      expect(
        StyleSheet.flatten(
          screen.getByTestId('starter-tour-spotlight', { includeHiddenElements: true }).props.style,
        ),
      ).toEqual(expect.objectContaining({ left: 9, top: 303, width: 342, height: 124 })),
    );
  });
});
