/**
 * 收集页面视觉交互约束回归。
 *
 * Responsibilities:
 * - 验证抽屉与底栏统一的主次操作及选择状态。
 * - 验证紧凑回听仍保留触控和可访问语义。
 * Notes:
 * - 不代替设备上的人工视觉检查。
 */
import { fireEvent, render } from '@testing-library/react-native';
import { ActionSheet } from '@/shared/ui/ActionSheet';
import { FixedActionButton } from '@/shared/ui/FixedActionButton';
import { colors, fontFamilies, textColors } from '@/shared/theme/tokens';
import { CollectionAudioControl, CollectionButton } from '../ui';

test('collection drawers have document action rows and centered secondary cancel', () => {
  const open = jest.fn();
  const screen = render(
    <ActionSheet
      visible
      title="历史收集"
      closeLabel="取消"
      onClose={jest.fn()}
      actions={[{ label: '打开文件夹', icon: 'folder-outline', onPress: open }]}
    />,
  );
  expect(screen.queryByTestId('icon-chevron-forward')).toBeNull();
  expect(screen.getByRole('button', { name: '打开文件夹' })).toHaveStyle({ minHeight: 52 });
  expect(screen.getByText('取消')).toHaveStyle({
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
  });
  // 背景关闭区域也叫取消，文字所在的按钮才是底部取消操作。
  expect(screen.getAllByRole('button', { name: '取消' }).at(-1)).toHaveStyle({ alignItems: 'center' });
  fireEvent.press(screen.getByRole('button', { name: '打开文件夹' }));
  expect(open).toHaveBeenCalledTimes(1);
});

test('footer primary action matches knowledge footer while choices use mint selection', () => {
  const screen = render(
    <FixedActionButton emphasized icon="checkmark-outline" label="保存规则" onPress={jest.fn()} />,
  );
  expect(screen.getByRole('button', { name: '保存规则' })).toHaveStyle({
    backgroundColor: colors.ink,
    minHeight: 56,
    justifyContent: 'center',
  });
  expect(screen.getByText('保存规则')).toHaveStyle({
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
  });
  const choices = render(<CollectionButton selected label="优点" onPress={jest.fn()} />);
  expect(choices.getByRole('button', { name: '优点' })).toHaveStyle({
    backgroundColor: colors.successSurface,
    borderColor: colors.success,
  });
  expect(choices.getByText('优点')).toHaveStyle({
    fontFamily: fontFamilies.sans,
    fontWeight: 'normal',
  });
});

test('compact playback exposes full action label and toggles its own pause icon', () => {
  const toggle = jest.fn();
  const screen = render(
    <CollectionAudioControl
      label="连续回听对话"
      compactLabel="对话"
      playing={false}
      onPress={toggle}
    />,
  );
  const control = screen.getByRole('button', { name: '连续回听对话' });
  expect(control).toHaveStyle({ minHeight: 44 });
  fireEvent.press(control);
  expect(toggle).toHaveBeenCalledTimes(1);
  screen.rerender(
    <CollectionAudioControl label="连续回听对话" compactLabel="对话" playing onPress={toggle} />,
  );
  expect(screen.getByTestId('icon-pause')).toBeTruthy();
  expect(screen.queryByText('暂停播放')).toBeNull();
});
