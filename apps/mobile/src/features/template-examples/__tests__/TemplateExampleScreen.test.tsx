/**
 * 模板只读示例页面测试。
 *
 * 验证不可播放提示、完整报告和独立失败重试状态。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { TemplateExampleScreen } from '../TemplateExampleScreen';
import { toTemplateAnalysisView } from '../templateAnalysisAdapter';
import { getGroupTemplateExample } from '@/shared/api/groupsApi';

jest.mock('@/shared/api/groupsApi', () => ({ getGroupTemplateExample: jest.fn() }));
jest.mock('@/shared/onboarding/StarterTourContext', () => ({
  useStarterTourTarget: () => undefined,
}));

const example = {
  templateKey: 'sales_call_review' as const,
  exampleVersion: 1,
  title: 'B2B 首次需求沟通示例',
  scenario: '首次沟通',
  playbackAvailable: false as const,
  roles: [{ id: 'sales', label: '销售' }],
  transcript: [
    {
      id: 's1',
      roleId: 'sales',
      roleLabel: '销售',
      emotion: '平静',
      startMs: 0,
      endMs: 1000,
      text: '先了解当前流程',
    },
  ],
  summarySections: [{ title: '沟通结果', body: '已约定演示' }],
  analysisTags: [
    {
      kind: 'strength' as const,
      title: '有效追问',
      detail: '形成问题链',
      evidenceSegmentIds: ['s1'],
    },
  ],
  recommendations: ['确认决策人'],
  limitations: ['产品演示内容'],
};

describe('TemplateExampleScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the non-playable transcript and report', async () => {
    jest.mocked(getGroupTemplateExample).mockResolvedValue(example);
    const screen = render(<TemplateExampleScreen groupId="group-1" onBack={jest.fn()} />);
    expect(await screen.findByText('示例不包含原始音频，无法播放')).toBeTruthy();
    expect(screen.getAllByTestId('top-level-page-header')).toHaveLength(1);
    expect(screen.getAllByLabelText('返回')).toHaveLength(1);
    expect(screen.getAllByRole('tab', { name: '转写分析' })).toHaveLength(2);
    expect(screen.getAllByRole('tab', { name: '分析总结' })).toHaveLength(2);
    expect(screen.getByText('有效追问')).toBeTruthy();
    expect(screen.getByText(/确认决策人/)).toBeTruthy();
    expect(screen.queryByText('分析任务')).toBeNull();
    expect(screen.queryByText('编辑并确认')).toBeNull();
    expect(screen.queryByRole('button', { name: /播放/ })).toBeNull();

    fireEvent.press(
      screen.getByTestId(
        'ai-tag-timeline-marker-template:sales_call_review:segment:s1-template:sales_call_review:tag:strength:0',
      ),
    );
    expect(screen.getByTestId('ai-tag-sheet')).toBeTruthy();
    expect(screen.getByText('证据：s1')).toBeTruthy();
  });

  it('maps template timestamps, roles, emotions, and evidence to stable read-only IDs', () => {
    const detail = toTemplateAnalysisView(example, 'zh-CN');
    const segment = detail.scenes[0].segments[0];

    expect(detail.id).toBe('template:sales_call_review:example:1');
    expect(segment).toEqual(
      expect.objectContaining({
        businessRole: '销售',
        emotion: '平静',
        endSeconds: 1,
        speakerKey: 'sales',
        startSeconds: 0,
      }),
    );
    expect(segment.aiTags[0]).toEqual(
      expect.objectContaining({
        evidenceSegmentIds: [segment.id],
        title: '有效追问',
      }),
    );
  });

  it('keeps failure local and retries the example request', async () => {
    jest
      .mocked(getGroupTemplateExample)
      .mockRejectedValueOnce(new Error('示例加载失败'))
      .mockResolvedValueOnce(example);
    const screen = render(<TemplateExampleScreen groupId="group-1" onBack={jest.fn()} />);
    expect(await screen.findByText('示例加载失败')).toBeTruthy();
    fireEvent.press(screen.getByText('重新加载'));
    expect((await screen.findAllByText('B2B 首次需求沟通示例')).length).toBeGreaterThan(0);
  });
});
