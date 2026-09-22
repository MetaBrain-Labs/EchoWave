/**
 * 分析总结内容测试。
 *
 * 验证本次分析限制默认收起，并通过可访问按钮展开和再次收起。
 *
 * Responsibilities:
 * - 覆盖限制列表的默认状态、展开状态和空列表状态。
 * - 覆盖报告头部的知识库分类摘要行。
 *
 * Notes:
 * - 只验证移动端展示交互，不连接真实分析后端。
 */
import type { AudioAnalysisDetail, RerankDisclosure } from '@echowave/contracts';
import { fireEvent, render } from '@testing-library/react-native';

import { analysisFixture } from '@/test/workspaceFixtures';
import { SummaryContent } from '../components/SummaryContent';
import { toAnalysisDetailView } from '../model';

/** 构造一份带发布结果的详情，用于报告头部断言。 */
function detailWithResult(
  retrievalCategories: {
    id: string;
    name: string;
    lookupReason: 'explicit' | 'auto' | 'default-route' | 'zero-hits' | 'evidence-insufficient';
    hitCount: number;
  }[],
  rerank?: RerankDisclosure,
) {
  return toAnalysisDetailView({
    ...analysisFixture,
    businessAnalysis: {
      ...analysisFixture.businessAnalysis,
      state: 'ready',
      jobId: 'a1000000-0000-4000-8000-000000000013',
      groupId: '10000000-0000-4000-8000-000000000001',
      model: 'deepseek-v4-flash',
      progress: 100,
      confirmationVersion: 1,
      result: {
        jobId: 'a1000000-0000-4000-8000-000000000013',
        groupId: '10000000-0000-4000-8000-000000000001',
        confirmationVersion: 1,
        model: 'deepseek-v4-flash',
        generatedAt: '2026-08-29T01:00:00.000Z',
        knowledgeBaseIds: ['a1000000-0000-4000-8000-000000000010'],
        knowledgeStatus: 'used',
        retrievalCategories,
        ...(rerank ? { rerank } : {}),
        limitations: [],
        summarySections: [],
        tags: [],
      },
    },
  } as AudioAnalysisDetail);
}

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

describe('SummaryContent retrieval categories', () => {
  it('summarises the frozen categories, selection reason and hit count', () => {
    const screen = render(
      <SummaryContent
        detail={detailWithResult([
          { id: 'c1', name: '产品资料', lookupReason: 'auto', hitCount: 4 },
          { id: 'c2', name: '话术案例', lookupReason: 'auto', hitCount: 2 },
        ])}
      />,
    );

    expect(
      screen.getByText('使用分类：产品资料、话术案例 · 模型选择分类 · 命中 6 条'),
    ).toBeTruthy();
  });

  it('states that the user constrained the categories when the filter was explicit', () => {
    const screen = render(
      <SummaryContent
        detail={detailWithResult([
          { id: 'c1', name: '合规要求', lookupReason: 'explicit', hitCount: 3 },
        ])}
      />,
    );

    expect(screen.getByText('使用分类：合规要求 · 用户限定分类 · 命中 3 条')).toBeTruthy();
  });

  it('omits the hit count when nothing was matched and caps long category lists', () => {
    const screen = render(
      <SummaryContent
        detail={detailWithResult([
          { id: 'c1', name: '分类一', lookupReason: 'default-route', hitCount: 0 },
          { id: 'c2', name: '分类二', lookupReason: 'default-route', hitCount: 0 },
          { id: 'c3', name: '分类三', lookupReason: 'default-route', hitCount: 0 },
          { id: 'c4', name: '分类四', lookupReason: 'default-route', hitCount: 0 },
        ])}
      />,
    );

    // 只列前三个分类，零命中时不显示命中段。
    expect(
      screen.getByText('使用分类：分类一、分类二、分类三、等 1 个 · 系统默认分类'),
    ).toBeTruthy();
    expect(screen.queryByText(/命中 0 条/)).toBeNull();
  });

  it('renders no category line for reports without retrieval audit', () => {
    const screen = render(<SummaryContent detail={detailWithResult([])} />);

    expect(screen.getByText('已使用 1 个关联知识库')).toBeTruthy();
    expect(screen.queryByText(/使用分类：/)).toBeNull();
    // 旧报告没有重排审计：不渲染重排说明。
    expect(screen.queryByTestId('rerank-disclosure')).toBeNull();
  });

  it('discloses the rerank effect recorded for the analysis', () => {
    const screen = render(
      <SummaryContent
        detail={detailWithResult(
          [{ id: 'c1', name: '产品资料', lookupReason: 'auto', hitCount: 4 }],
          {
            status: 'applied',
            model: 'qwen3.7-text-rerank',
            candidateCount: 20,
            selectedCount: 5,
            promotedCount: 3,
            reordered: true,
            measured: true,
            durationMs: 420,
            tokens: 11,
            fallbackReason: null,
          },
        )}
      />,
    );

    expect(screen.getByTestId('rerank-disclosure')).toBeTruthy();
    expect(
      screen.getByText(
        /已使用智能重排（qwen3\.7-text-rerank）对 20 条候选重新排序：入选 5 条证据，其中 3 条来自重排提升（420 ms）。/,
      ),
    ).toBeTruthy();
  });
});
