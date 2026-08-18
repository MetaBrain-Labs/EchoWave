import { fireEvent, render } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import { GroupScreen } from '../GroupScreen';

describe('GroupScreen', () => {
  it('uses the special group title and inline icon sizing rules', () => {
    const screen = render(<GroupScreen />);

    expect(
      StyleSheet.flatten(screen.getByText('分组名称').props.style),
    ).toEqual(
      expect.objectContaining({
        fontSize: 40,
        fontWeight: 'bold',
        lineHeight: 60,
      }),
    );
    expect(
      StyleSheet.flatten(screen.getByTestId('icon-hourglass-outline').props.style),
    ).toEqual({ height: 14, width: 14 });
  });

  it('switches among the three group content tabs', () => {
    const screen = render(<GroupScreen />);

    expect(screen.getByText('共 5 份音频')).toBeTruthy();

    fireEvent.press(screen.getByText('关联知识库'));
    expect(screen.getByText('共关联 3 个知识库')).toBeTruthy();

    fireEvent.press(screen.getByText('连接数据源'));
    expect(screen.getByText('共连接 3 个数据源')).toBeTruthy();
  });

  it('synchronizes the selected group tab after a horizontal swipe', () => {
    const screen = render(<GroupScreen />);

    fireEvent(screen.getByTestId('group-tab-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 480, y: 0 } },
    });

    expect(
      screen.getByRole('tab', { name: '关联知识库' }).props.accessibilityState,
    ).toEqual({ selected: true });
  });

  it('provides feedback for placeholder actions', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<GroupScreen />);

    fireEvent.press(screen.getByLabelText('搜索'));

    expect(alert).toHaveBeenCalledWith(
      '功能建设中',
      '搜索将在后续版本开放。',
    );
    alert.mockRestore();
  });

  it('opens only completed audio records', () => {
    const onOpenAudio = jest.fn();
    const screen = render(<GroupScreen onOpenAudio={onOpenAudio} />);

    fireEvent.press(
      screen.getByLabelText('产品访谈分析，分析已完成'),
    );

    expect(onOpenAudio).toHaveBeenCalledWith('audio-1');
    expect(screen.queryByLabelText('待整理录音，分析已完成')).toBeNull();
  });
});
