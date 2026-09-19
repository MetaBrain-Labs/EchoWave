/**
 * 顶部栏引导按钮测试。
 *
 * 验证引导型内容启动指定引导并带上来源页，提示型内容只请求宿主切换说明卡片。
 *
 * Notes:
 * - 引导编排使用内存替身，不渲染真实引导浮层。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { StarterTourContext } from '@/shared/onboarding/StarterTourContext';
import { GUIDE_IDS, type GuideId } from '@/shared/onboarding/guideRegistry';
import { GuideButton } from '../GuideButton';

const startGuide = jest.fn();

function renderButton(node: React.ReactElement) {
  return render(
    <StarterTourContext.Provider
      value={{
        activeGuide: null,
        activeStep: null,
        offerStarterTemplates: jest.fn(),
        registerTarget: jest.fn(),
        replay: jest.fn(),
        startGuide,
        statuses: Object.fromEntries(GUIDE_IDS.map((id) => [id, 'not_started'])) as Record<
          GuideId,
          'not_started'
        >,
        templates: {},
      }}
    >
      {node}
    </StarterTourContext.Provider>,
  );
}

describe('GuideButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts the feature guide with its origin page', () => {
    const screen = renderButton(
      <GuideButton content={{ guide: 'data_sources', kind: 'tour', returnTo: '/sources/abc' }} />,
    );

    fireEvent.press(screen.getByLabelText('开始本功能的引导'));

    expect(startGuide).toHaveBeenCalledWith('data_sources', '/sources/abc');
  });

  it('asks the host to toggle the hint card instead of starting a guide', () => {
    const onToggleHint = jest.fn();
    const screen = renderButton(
      <GuideButton
        content={{ kind: 'hint', namespace: 'guideHint.createHub' }}
        expanded={false}
        onToggleHint={onToggleHint}
      />,
    );

    const button = screen.getByLabelText('查看本功能能做什么');
    expect(button.props.accessibilityState).toEqual({ expanded: false });
    fireEvent.press(button);

    expect(onToggleHint).toHaveBeenCalledTimes(1);
    expect(startGuide).not.toHaveBeenCalled();
  });

  it('reports the expanded state for hint content', () => {
    const screen = renderButton(
      <GuideButton
        content={{ kind: 'hint', namespace: 'guideHint.createHub' }}
        expanded
        onToggleHint={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('查看本功能能做什么').props.accessibilityState).toEqual({
      expanded: true,
    });
  });
});
