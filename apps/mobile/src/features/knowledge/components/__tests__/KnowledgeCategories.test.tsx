/**
 * 知识类别交互回归。
 *
 * 验证默认类别、建议确认、失败草稿和有界显式检索筛选。
 *
 * Responsibilities:
 * - 使用模拟 API 覆盖保存版本、超时与重试。
 *
 * Notes:
 * - 不连接真实模型或数据库。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { DocumentClassification, KnowledgeCategory } from '@echowave/contracts';
import { CategoryManager } from '../CategoryManager';
import { CategoryQueryFilter } from '../CategoryQueryFilter';
import { DocumentClassificationEditor } from '../DocumentClassificationEditor';
import { KnowledgeBaseEditor } from '../KnowledgeBaseEditor';
import { knowledge } from '../../testing/fixtures';
import {
  listKnowledgeCategories,
  listRetrievalCategories,
  listRetrievalCategoriesByBase,
  createKnowledgeCategory,
  updateKnowledgeCategory,
  getDocumentClassification,
  updateDocumentClassification,
  updateKnowledgeBase,
} from '../../apiClient';
jest.mock('../../apiClient');
const categories: KnowledgeCategory[] = ['通用资料', '产品资料', '测试样例', '业务规则/SOP'].map(
  (name, index) => ({
    id: `11111111-1111-4111-8111-11111111111${index}`,
    key: ['general', 'product', 'test', 'sop'][index]!,
    name,
    description: 'Category purpose',
    active: true,
    version: 2,
  }),
);
const classification: DocumentClassification = {
  revisionId: '22222222-2222-4222-8222-222222222222',
  version: 3,
  documentVersion: 1,
  defaultCategoryId: categories[0]!.id,
  documentCategoryId: null,
  sheets: ['术语热词', '纠错测试样例'],
  sheetAssignments: [],
  suggestion: {
    status: 'pending',
    documentCategoryId: categories[1]!.id,
    sheets: [{ sheet: '纠错测试样例', categoryId: categories[2]!.id }],
    message: '',
  },
};
describe('knowledge category interactions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(listKnowledgeCategories).mockResolvedValue({ items: categories });
    jest.mocked(listRetrievalCategories).mockResolvedValue({ items: categories });
    jest.mocked(getDocumentClassification).mockResolvedValue(classification);
  });
  it('saves a knowledge default category with its concurrency version', async () => {
    jest.mocked(updateKnowledgeBase).mockResolvedValue(knowledge);
    const screen = render(
      <KnowledgeBaseEditor
        knowledge={{ ...knowledge, defaultCategoryId: categories[0]!.id, categoryVersion: 2 }}
        visible
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('产品资料')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('产品资料'));
    fireEvent.press(screen.getByText('确认'));
    await waitFor(() =>
      expect(updateKnowledgeBase).toHaveBeenCalledWith(
        knowledge.id,
        knowledge.name,
        knowledge.description,
        { defaultCategoryId: categories[1]!.id, expectedCategoryVersion: 2 },
      ),
    );
  });
  it('does not apply model suggestions until the user confirms', async () => {
    const updated: DocumentClassification = {
      ...classification,
      version: 4,
      documentCategoryId: categories[1]!.id,
      sheetAssignments: classification.suggestion!.sheets,
      suggestion: { ...classification.suggestion!, status: 'confirmed' },
    };
    jest.mocked(updateDocumentClassification).mockResolvedValue(updated);
    const screen = render(
      <DocumentClassificationEditor
        knowledgeId={knowledge.id}
        documentId="doc"
        onChanged={jest.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(getDocumentClassification).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('类别与工作表'));
    await waitFor(() => expect(screen.getByText('建议尚未确认，不影响当前分类。')).toBeTruthy());
    expect(updateDocumentClassification).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('确认建议并生效'));
    await waitFor(() =>
      expect(updateDocumentClassification).toHaveBeenCalledWith(knowledge.id, 'doc', {
        revisionId: classification.revisionId,
        expectedVersion: 3,
        expectedDocumentVersion: 1,
        documentCategoryId: categories[1]!.id,
        sheetAssignments: classification.suggestion!.sheets,
        confirmSuggestion: true,
      }),
    );
    await waitFor(() => expect(screen.getByText('建议已确认')).toBeTruthy());
  });
  it('keeps category actions in a fixed footer outside the scrollable content', async () => {
    const screen = render(
      <DocumentClassificationEditor
        knowledgeId={knowledge.id}
        documentId="doc"
        onChanged={jest.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.press(screen.getByText('类别与工作表'));
    await waitFor(() =>
      expect(screen.getByText('建议尚未确认，不影响当前分类。')).toBeTruthy(),
    );

    const scrollableContent = screen.getByTestId('document-classification-scroll');
    expect(
      scrollableContent.findAllByProps({ testID: 'document-classification-footer' }),
    ).toHaveLength(0);
    expect(screen.getByTestId('document-classification-footer')).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存类别' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
  });
  it('keeps a failed worksheet draft and allows a version-safe retry', async () => {
    jest
      .mocked(updateDocumentClassification)
      .mockRejectedValueOnce(new Error('版本已变化'))
      .mockResolvedValue({
        ...classification,
        version: 4,
        sheetAssignments: [{ sheet: '纠错测试样例', categoryId: categories[2]!.id }],
      });
    const screen = render(
      <DocumentClassificationEditor
        knowledgeId={knowledge.id}
        documentId="doc"
        onChanged={jest.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.press(screen.getByText('类别与工作表'));
    await waitFor(() =>
      expect(screen.getByText('纠错测试样例: 继承默认类别 · 通用资料')).toBeTruthy(),
    );
    fireEvent.press(screen.getByText('纠错测试样例: 继承默认类别 · 通用资料'));
    fireEvent.press(screen.getByLabelText('测试样例'));
    fireEvent.press(screen.getByText('保存类别'));
    await waitFor(() => expect(screen.getByText('版本已变化')).toBeTruthy());
    expect(screen.getAllByText('纠错测试样例: 测试样例').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('保存类别'));
    await waitFor(() => expect(updateDocumentClassification).toHaveBeenCalledTimes(2));
    expect(jest.mocked(updateDocumentClassification).mock.calls[1]![2].sheetAssignments).toEqual([
      { sheet: '纠错测试样例', categoryId: categories[2]!.id },
    ]);
  });
  it('retries catalogue failure and allows unlimited multi-select', async () => {
    jest
      .mocked(listRetrievalCategoriesByBase)
      .mockResolvedValueOnce({ categories: [], failed: 1 })
      .mockResolvedValue({
        failed: 0,
        categories: categories.map((item) => ({ ...item, knowledgeBaseId: knowledge.id })),
      });
    const onChange = jest.fn();
    const screen = render(
      <CategoryQueryFilter
        knowledgeId={knowledge.id}
        selected={[]}
        onChange={onChange}
        disabled={false}
      />,
    );
    fireEvent.press(screen.getByText('检索类别: 自动选择类别'));
    await waitFor(() => expect(screen.getByText('类别加载失败，请重试。')).toBeTruthy());
    fireEvent.press(screen.getByText('刷新类别'));
    await waitFor(() => expect(screen.getByLabelText('产品资料')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('产品资料'));
    expect(onChange).toHaveBeenCalledWith([categories[1]!.id]);
    // 多选不设数量上限：已选满三个类别时第四个仍可勾选。
    screen.rerender(
      <CategoryQueryFilter
        knowledgeId={knowledge.id}
        selected={categories.slice(0, 3).map((item) => item.id)}
        onChange={onChange}
        disabled={false}
      />,
    );
    onChange.mockClear();
    fireEvent.press(screen.getByLabelText('业务规则/SOP'));
    expect(onChange).toHaveBeenCalledWith([
      ...categories.slice(0, 3).map((item) => item.id),
      categories[3]!.id,
    ]);
  });
  it('groups categories by knowledge base and marks an excluded base', async () => {
    const secondBaseId = '22222222-2222-4222-8222-222222222222';
    const bases = [
      { id: knowledge.id, name: '产品研究知识库' },
      { id: secondBaseId, name: '术语知识库' },
    ];
    jest.mocked(listRetrievalCategoriesByBase).mockResolvedValue({
      failed: 0,
      categories: [
        { ...categories[1]!, knowledgeBaseId: knowledge.id },
        { ...categories[3]!, id: 'cat-term', name: '术语纠错', knowledgeBaseId: secondBaseId },
      ],
    });
    const onChange = jest.fn();
    const screen = render(
      <CategoryQueryFilter
        knowledgeId={knowledge.id}
        knowledgeBases={bases}
        selected={[]}
        onChange={onChange}
        disabled={false}
      />,
    );

    // 默认两个关联库都参与检索。
    await waitFor(() => expect(screen.getByText('参与检索的知识库：2 个')).toBeTruthy());
    fireEvent.press(screen.getByText('检索类别: 自动选择类别'));

    // 跨库时按知识库分组展示类别，每个库都有独立分组标题与范围开关。
    expect(screen.getAllByText('产品研究知识库').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('术语知识库').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('术语纠错')).toBeTruthy();
    expect(
      screen.getByText('支持多选且不限制数量；可按知识库取消参与检索，手动筛选不会自动扩大。'),
    ).toBeTruthy();
    // 跨库不提供“自动选择类别”：取消全部类别只会缩小范围，不会扩大检索。
    expect(screen.queryByText('自动选择类别')).toBeNull();
    // 取消单个类别只改变类别选择，不改变参与检索的知识库集合。
    fireEvent.press(screen.getByLabelText('术语纠错'));
    expect(onChange).toHaveBeenCalledWith(['cat-term']);
    expect(screen.getByText('参与检索的知识库：2 个')).toBeTruthy();
    expect(screen.queryByText('该知识库已取消参与本次检索。')).toBeNull();

    // 取消某个知识库后：范围计数减少，该库分组不再渲染可选类别。
    screen.rerender(
      <CategoryQueryFilter
        knowledgeId={knowledge.id}
        knowledgeBases={bases}
        excludedKnowledgeBaseIds={[secondBaseId]}
        selected={[]}
        onChange={jest.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByText('参与检索的知识库：1 个')).toBeTruthy();
    expect(screen.getByText('该知识库已取消参与本次检索。')).toBeTruthy();
    expect(screen.queryByLabelText('术语纠错')).toBeNull();
    expect(screen.getByLabelText('产品资料')).toBeTruthy();
  });

  it('preserves failed custom-category input and sends versions when deactivating', async () => {
    jest
      .mocked(createKnowledgeCategory)
      .mockRejectedValueOnce(new Error('请求超时'))
      .mockResolvedValue(categories[1]!);
    jest
      .mocked(updateKnowledgeCategory)
      .mockResolvedValue({ ...categories[1]!, active: false, version: 3 });
    const onChanged = jest.fn().mockResolvedValue(undefined);
    const screen = render(<CategoryManager categories={categories} onChanged={onChanged} />);
    fireEvent.press(screen.getByText('管理类别'));
    fireEvent.changeText(screen.getByLabelText('类别名称'), '会员规则');
    fireEvent.changeText(screen.getByLabelText('类别用途说明'), '会员权益与使用规则');
    fireEvent.press(screen.getByText('保存类别'));
    await waitFor(() => expect(screen.getByText('请求超时')).toBeTruthy());
    expect(screen.getByDisplayValue('会员规则')).toBeTruthy();
    fireEvent.press(screen.getByText('保存类别'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByText('产品资料'));
    fireEvent.press(screen.getByText('停用'));
    await waitFor(() =>
      expect(updateKnowledgeCategory).toHaveBeenCalledWith(categories[1]!.id, {
        name: '产品资料',
        description: 'Category purpose',
        expectedVersion: 2,
        active: false,
      }),
    );
  });
});
