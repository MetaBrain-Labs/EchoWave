/**
 * 分析总结内容测试。
 *
 * 验证本次分析限制默认收起，并通过可访问按钮展开和再次收起。
 *
 * Responsibilities:
 * - 覆盖限制列表的默认状态、展开状态和空列表状态。
 *
 * Notes:
 * - 只验证移动端展示交互，不连接真实分析后端。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { analysisFixture } from '@/test/workspaceFixtures';
import { SummaryContent } from '../components/SummaryContent';
import { toAnalysisDetailView } from '../model';

describe('SummaryContent limitations', () => {
  it('keeps limitations collapsed by default and toggles them accessibly', () => {
    const screen = render(
      <SummaryContent
        detail={toAnalysisDetailView(analysisFixture)}
        limitations={['上传完成前关闭 App 可能中断任务。']}
      />,
    );

    const expander = screen.getByRole('button', { name: '展开本次分析限制' });
    expect(expander.props.accessibilityState).toEqual({ expanded: false });
    expect(screen.queryByText('• 上传完成前关闭 App 可能中断任务。')).toBeNull();

    fireEvent.press(expander);

    const collapseButton = screen.getByRole('button', { name: '收起本次分析限制' });
    expect(collapseButton.props.accessibilityState).toEqual({ expanded: true });
    expect(screen.getByText('• 上传完成前关闭 App 可能中断任务。')).toBeTruthy();

    fireEvent.press(collapseButton);

    expect(screen.queryByText('• 上传完成前关闭 App 可能中断任务。')).toBeNull();
  });

  it('does not render an empty limitations block', () => {
    const screen = render(
      <SummaryContent detail={toAnalysisDetailView(analysisFixture)} limitations={[]} />,
    );

    expect(screen.queryByRole('button', { name: '展开本次分析限制' })).toBeNull();
    expect(screen.queryByText('本次分析限制')).toBeNull();
  });
});
