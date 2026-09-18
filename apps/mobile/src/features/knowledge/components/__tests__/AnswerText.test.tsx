/**
 * 可信回答正文测试。
 *
 * 验证引用标记的可点击范围与正文渲染约束：标记必须包在 Text 内，越界编号保持纯文本。
 *
 * Responsibilities:
 * - 锁定正文标记的拆分结果与无障碍名称。
 * - 锁定正文区域内不出现裸字符串子节点。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { AnswerText } from '../AnswerText';
import { findRawTextViolations, type RenderedNode } from '../../testing/renderTextGuard';

describe('AnswerText', () => {
  it('exposes in-range markers as tappable link segments', () => {
    const onOpenCitationMarker = jest.fn();
    const screen = render(
      <AnswerText
        answer={'结论来自第一份资料[1]，补充见第三份[3]。越界编号[9]保持纯文本。'}
        citationCount={3}
        onOpenCitationMarker={onOpenCitationMarker}
      />,
    );

    expect(screen.getByLabelText('引用 1')).toBeTruthy();
    expect(screen.getByLabelText('引用 3')).toBeTruthy();
    expect(screen.queryByLabelText('引用 9')).toBeNull();
    expect(screen.getByText(/越界编号\[9\]保持纯文本/)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('引用 3'));
    expect(onOpenCitationMarker).toHaveBeenCalledWith(3);
  });

  it('renders no raw text outside a Text component', () => {
    const screen = render(
      <AnswerText
        answer={'第一条结论成立[1]，第二条见另一份资料[2]。'}
        citationCount={2}
        onOpenCitationMarker={jest.fn()}
        style={{ color: '#000', fontSize: 14 }}
      />,
    );

    // 裸字符串（如 {' '}）会让 React Native 抛出 "Text strings must be rendered within a <Text>"。
    expect(findRawTextViolations(screen.toJSON() as RenderedNode)).toHaveLength(0);
  });
});
