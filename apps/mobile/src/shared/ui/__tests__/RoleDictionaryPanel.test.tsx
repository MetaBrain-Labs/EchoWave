/**
 * 角色识别词典面板测试。
 *
 * 验证按数据源读取词典、核心角色只读展示、自定义角色可增删，以及四类本地校验。
 *
 * Responsibilities:
 * - 锁定读取的数据源、展示内容与增删后的保存载荷。
 * - 锁定空值、核心角色重名、重复角色和数量上限都不触发保存。
 * - 锁定读取或保存失败时的降级与回调。
 *
 * Notes:
 * - 数据源接口使用内存替身，不发起网络请求。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { getDataSource, updateDataSource } from '@/shared/api/dataSourcesApi';
import { RoleDictionaryPanel } from '../RoleDictionaryPanel';

jest.mock('@/shared/api/dataSourcesApi', () => ({
  getDataSource: jest.fn(),
  updateDataSource: jest.fn(),
}));

const mockedGet = jest.mocked(getDataSource);
const mockedUpdate = jest.mocked(updateDataSource);
const sourceId = '20000000-0000-4000-8000-000000000001';

/** 只提供面板需要字段的数据源详情替身。 */
function sourceDetail(customBusinessRoles: string[]) {
  return {
    id: sourceId,
    settings: { customBusinessRoles },
  } as unknown as Awaited<ReturnType<typeof getDataSource>>;
}

async function renderPanel(customRoles: string[] = ['售后']) {
  mockedGet.mockResolvedValue(sourceDetail(customRoles));
  mockedUpdate.mockImplementation(async (_id, input) =>
    sourceDetail((input.customBusinessRoles as string[]) ?? []),
  );
  const onError = jest.fn();
  const screen = render(<RoleDictionaryPanel onError={onError} sourceId={sourceId} />);
  await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(sourceId));
  return { onError, screen };
}

describe('RoleDictionaryPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing without a data source', () => {
    const screen = render(<RoleDictionaryPanel sourceId={null} />);

    expect(screen.toJSON()).toBeNull();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('hides itself when the data source cannot be read', async () => {
    mockedGet.mockRejectedValueOnce(new Error('数据源不可用。'));
    const screen = render(<RoleDictionaryPanel sourceId={sourceId} />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(sourceId));
    expect(screen.toJSON()).toBeNull();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('lists the fixed core roles and the data source custom roles', async () => {
    const { screen } = await renderPanel(['售后', '技术顾问']);

    for (const core of ['销售', '客户', '其他', '未知']) {
      expect(screen.getByText(core)).toBeTruthy();
    }
    expect(screen.getByText('售后')).toBeTruthy();
    expect(screen.getByText('技术顾问')).toBeTruthy();
    // 核心角色不可移除：没有对应的删除操作。
    expect(screen.queryByLabelText('删除自定义角色：销售')).toBeNull();
  });

  it('explains that only core roles apply when no custom role exists', async () => {
    const { screen } = await renderPanel([]);

    expect(screen.getByText(/尚未添加自定义角色/)).toBeTruthy();
  });

  it('persists a trimmed custom role and adopts the returned list', async () => {
    const { screen } = await renderPanel(['售后']);

    fireEvent.changeText(screen.getByLabelText('新增自定义角色'), '  技术顾问  ');
    fireEvent.press(screen.getByLabelText('添加'));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(sourceId, {
        customBusinessRoles: ['售后', '技术顾问'],
      }),
    );
    expect(await screen.findByText('技术顾问')).toBeTruthy();
    // 输入框在提交后清空，便于连续添加。
    expect(screen.getByLabelText('新增自定义角色').props.value).toBe('');
  });

  it('removes an existing custom role', async () => {
    const { screen } = await renderPanel(['售后', '技术顾问']);

    fireEvent.press(screen.getByLabelText('删除自定义角色：售后'));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(sourceId, {
        customBusinessRoles: ['技术顾问'],
      }),
    );
  });

  it('keeps the previous roles and reports the error when saving fails', async () => {
    const { onError, screen } = await renderPanel(['售后']);
    mockedUpdate.mockRejectedValueOnce(new Error('保存失败。'));

    fireEvent.changeText(screen.getByLabelText('新增自定义角色'), '技术顾问');
    fireEvent.press(screen.getByLabelText('添加'));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    // 失败时不乐观更新：界面仍显示保存前的角色。
    expect(screen.getByText('售后')).toBeTruthy();
    expect(screen.queryByText('技术顾问')).toBeNull();
  });

  it('rejects a core role, a duplicate and an empty value locally', async () => {
    const { screen } = await renderPanel(['售后']);

    // 与核心角色重名
    fireEvent.changeText(screen.getByLabelText('新增自定义角色'), '销售');
    fireEvent.press(screen.getByLabelText('添加'));
    expect(screen.getByText('核心角色已默认包含，无需重复添加。')).toBeTruthy();

    // 与已有自定义角色重复
    fireEvent.changeText(screen.getByLabelText('新增自定义角色'), '售后');
    fireEvent.press(screen.getByLabelText('添加'));
    expect(screen.getByText('该自定义角色已存在。')).toBeTruthy();

    // 空值直接忽略
    fireEvent.changeText(screen.getByLabelText('新增自定义角色'), '   ');
    fireEvent.press(screen.getByLabelText('添加'));

    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('blocks adding beyond the 16-role server limit', async () => {
    const { screen } = await renderPanel(
      Array.from({ length: 16 }, (_, index) => `角色${index + 1}`),
    );

    fireEvent.changeText(screen.getByLabelText('新增自定义角色'), '第 17 个');
    fireEvent.press(screen.getByLabelText('添加'));

    expect(screen.getByText(/每个数据源最多添加 16 个自定义角色/)).toBeTruthy();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});
