/**
 * 引导中心页面测试。
 *
 * 验证六项状态、步骤数、独立开始和已完成项重播。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { GuideCenterScreen } from '../GuideCenterScreen';

const mockStartGuide = jest.fn();
jest.mock('@/shared/onboarding/StarterTourContext', () => ({
  useStarterTour: () => ({
    startGuide: mockStartGuide,
    statuses: {
      basic: 'completed',
      knowledge: 'not_started',
      data_sources: 'skipped',
      ai_configuration: 'not_started',
      runtime_mode: 'not_started',
      analysis: 'not_started',
    },
    templates: { sales_call_review: 'group-1' },
  }),
}));

describe('GuideCenterScreen', () => {
  it('renders six independent guides and starts the selected one', () => {
    const screen = render(<GuideCenterScreen onBack={jest.fn()} />);
    for (const label of [
      '重播基础引导',
      '开始知识库引导',
      '重播数据源引导',
      '开始AI 配置引导',
      '开始运行模式引导',
      '开始查看分析引导',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已跳过').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByLabelText('开始知识库引导'));
    expect(mockStartGuide).toHaveBeenCalledWith('knowledge');
    fireEvent.press(screen.getByLabelText('重播基础引导'));
    expect(mockStartGuide).toHaveBeenCalledWith('basic');
  });
});
