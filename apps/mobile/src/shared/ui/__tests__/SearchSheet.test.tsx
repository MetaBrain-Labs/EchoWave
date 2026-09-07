/**
 * 通用搜索抽屉测试。
 *
 * 验证原生键盘避让和搜索输入、清除、提交、关闭等可观察行为。
 *
 * Responsibilities:
 * - 确保 Android 键盘出现时搜索抽屉仍位于键盘上方。
 * - 锁定搜索词规范化和操作按钮的交互契约。
 *
 * Notes:
 * - 真机键盘遮挡由 Maestro Flow 进行布局验收，本文件不模拟系统输入法窗口。
 */
import { fireEvent, render } from '@testing-library/react-native';
import { KeyboardAvoidingView, Platform } from 'react-native';

import { SearchSheet } from '../SearchSheet';

const defaultProps = {
  inputLabel: '输入搜索关键词',
  onApply: jest.fn(),
  onClose: jest.fn(),
  placeholder: '搜索内容',
  title: '搜索内容',
  visible: true,
};

function setPlatform(os: 'android' | 'ios' | 'web') {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

describe('SearchSheet', () => {
  beforeEach(() => {
    setPlatform('android');
    jest.clearAllMocks();
  });

  it.each([
    ['android', 'padding'],
    ['ios', 'padding'],
    ['web', undefined],
  ] as const)('uses the expected keyboard behavior on %s', (os, behavior) => {
    setPlatform(os);

    const screen = render(<SearchSheet {...defaultProps} appliedQuery="" />);

    expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe(behavior);
  });

  it('normalizes and submits the query, and supports clearing and closing', () => {
    const onApply = jest.fn();
    const onClose = jest.fn();
    const screen = render(
      <SearchSheet {...defaultProps} appliedQuery="已应用" onApply={onApply} onClose={onClose} />,
    );

    expect(screen.getByDisplayValue('已应用')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('清除搜索'));
    expect(screen.queryByLabelText('清除搜索')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('输入搜索关键词'), '  新查询  ');
    fireEvent.press(screen.getByLabelText('执行搜索'));
    expect(onApply).toHaveBeenCalledWith('新查询');

    fireEvent.press(screen.getByLabelText('关闭搜索抽屉'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
