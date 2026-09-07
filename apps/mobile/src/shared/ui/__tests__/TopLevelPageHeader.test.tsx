/**
 * 一级页面固定页头测试。
 *
 * 验证统一页头的标题节奏、操作尺寸、可访问状态和交互回调。
 *
 * Responsibilities:
 * - 锁定一级页面页头的公共视觉尺寸。
 * - 覆盖图标操作、文字操作和禁用状态。
 *
 * Notes:
 * - 图标通过全局 Ionicons 测试替身渲染。
 */
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { colors, radii, spacing } from '@/shared/theme/tokens';
import { TopLevelPageHeader } from '../TopLevelPageHeader';

describe('TopLevelPageHeader', () => {
  it('uses the shared title rhythm and renders an optional subtitle', () => {
    const screen = render(<TopLevelPageHeader subtitle="页面说明" title="知识库" />);

    expect(screen.getByRole('header', { name: '知识库' })).toBeTruthy();
    expect(screen.getByText('页面说明')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('top-level-page-header').props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: colors.canvas,
        paddingBottom: spacing.lg,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
      }),
    );
  });

  it('keeps actions accessible, consistently sized, and interactive', () => {
    const onSearch = jest.fn();
    const onCreate = jest.fn();
    const screen = render(
      <TopLevelPageHeader
        actions={[
          { accessibilityLabel: '搜索知识库', icon: 'search-outline', onPress: onSearch },
          {
            accessibilityLabel: '新建知识库',
            icon: 'add',
            label: '新建',
            onPress: onCreate,
            testID: 'e2e-new-knowledge-base',
          },
        ]}
        title="知识库"
      />,
    );

    const search = screen.getByLabelText('搜索知识库');
    const create = screen.getByLabelText('新建知识库');
    expect(screen.getByTestId('e2e-new-knowledge-base')).toBe(create);
    expect(StyleSheet.flatten(search.props.style)).toEqual(
      expect.objectContaining({ height: 44, width: 44 }),
    );
    expect(StyleSheet.flatten(create.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: colors.card,
        borderColor: colors.divider,
        borderRadius: radii.default,
        minHeight: 44,
      }),
    );

    fireEvent.press(search);
    fireEvent.press(create);
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('renders an optional back action for standalone top-level routes', () => {
    const onBack = jest.fn();
    const screen = render(<TopLevelPageHeader onBack={onBack} title="分析" />);

    fireEvent.press(screen.getByLabelText('返回'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('header', { name: '分析' })).toBeTruthy();
  });

  it('exposes and enforces a disabled action state', () => {
    const onCreate = jest.fn();
    const screen = render(
      <TopLevelPageHeader
        actions={[
          {
            accessibilityLabel: '新建知识库',
            disabled: true,
            icon: 'add',
            label: '新建',
            onPress: onCreate,
          },
        ]}
        title="知识库"
      />,
    );

    const create = screen.getByLabelText('新建知识库');
    expect(create.props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(create);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
