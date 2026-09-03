/**
 * 一级标签页面视觉测试。
 *
 * 验证“更多”和“新建”页面接入统一固定页头，并保持公共卡片与占位内容结构一致。
 *
 * Responsibilities:
 * - 锁定固定页头与正文滚动容器的兄弟结构。
 * - 验证公共卡片外框和新建页标题不会重复。
 *
 * Notes:
 * - 服务状态与路由使用轻量替身，避免真实网络和导航副作用。
 */
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CreateScreen from '../create';
import MoreScreen from '../more';
import { colors, radii, spacing } from '@/shared/theme/tokens';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe('Top-level tab screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the More header fixed and uses three unified navigation cards', () => {
    const screen = render(<MoreScreen />);

    const header = screen.getByTestId('top-level-page-header');
    const scroll = screen.getByTestId('more-scroll');
    expect(header).toBeTruthy();
    expect(scroll.findAllByProps({ testID: 'top-level-page-header' })).toHaveLength(0);

    for (const card of [
      screen.getByLabelText('打开服务状态'),
      screen.getByLabelText('打开 AI 配置'),
      screen.getByLabelText('打开运行模式'),
    ]) {
      expect(StyleSheet.flatten(card.props.style)).toEqual(
        expect.objectContaining({
          backgroundColor: colors.card,
          borderColor: colors.divider,
          borderRadius: radii.default,
          padding: spacing.md,
        }),
      );
    }

    fireEvent.press(screen.getByLabelText('打开 AI 配置'));
    expect(mockPush).toHaveBeenCalledWith('/settings');
    fireEvent.press(screen.getByLabelText('打开服务状态'));
    expect(mockPush).toHaveBeenCalledWith('/service-status');
    fireEvent.press(screen.getByLabelText('打开运行模式'));
    expect(mockPush).toHaveBeenCalledWith('/audio-runtime');
  });

  it('renders one fixed Create title and keeps the placeholder body separate', () => {
    const screen = render(<CreateScreen />);

    expect(screen.getAllByText('新建')).toHaveLength(1);
    expect(screen.getByRole('header', { name: '新建' })).toBeTruthy();
    expect(screen.getByTestId('placeholder-content')).toBeTruthy();
  });
});
