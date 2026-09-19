/**
 * 一键分析创建页测试。
 *
 * 验证紧凑的数据源和分组菜单、后台处理说明和开始确认行为。
 */
import type {
  AudioFileSummary,
  DataSourceSummary,
  LinkedDataSourceGroup,
} from '@echowave/contracts';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { AnalysisBatchCreateScreen } from '../AnalysisBatchCreateScreen';
import {
  createExistingAudioAnalysisBatch,
  listAudioAnalysisBatches,
} from '@/shared/api/audioAutomationApi';
import {
  getDataSource,
  listDataSourceAudioFiles,
  listDataSourceGroups,
  listDataSources,
  updateDataSource,
} from '@/shared/api/dataSourcesApi';
import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';
import { getGroupSettings } from '@/shared/api/groupsApi';
import { AnalysisPreferenceProvider } from '@/shared/settings/AnalysisPreferenceProvider';

const sources = Array.from(
  { length: 6 },
  (_, index) =>
    ({
      id: `source-${index + 1}`,
      name: `数据源 ${index + 1}`,
      description: '',
      sourceType: 'manual_upload',
      location: 'local',
      connectionLabel: 'test',
      connectionStatus: 'connected',
      linkedGroupCount: 6,
      lastUploadedAt: null,
    }) as DataSourceSummary,
);
const groups = Array.from(
  { length: 6 },
  (_, index) =>
    ({
      id: `group-${index + 1}`,
      name: `分组 ${index + 1}`,
      analysisCount: 0,
      audioCount: 0,
      knowledgeCount: 0,
      sourceCount: 1,
    }) as LinkedDataSourceGroup,
);
const existingAudio = {
  id: 'audio-1',
  title: '已上传音频',
  runtimeMode: 'object_storage',
  sourceState: 'available',
  acousticEmotionReady: false,
} as AudioFileSummary;

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => callback,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/shared/api/audioAutomationApi', () => ({
  createExistingAudioAnalysisBatch: jest.fn(),
  createUploadAnalysisBatch: jest.fn(),
  listAudioAnalysisBatches: jest.fn(),
}));
jest.mock('@/shared/api/audioRuntimeApi', () => ({ getAudioRuntime: jest.fn() }));
jest.mock('@/shared/api/dataSourcesApi', () => ({
  getDataSource: jest.fn(),
  listDataSourceAudioFiles: jest.fn(),
  listDataSourceGroups: jest.fn(),
  listDataSources: jest.fn(),
  updateDataSource: jest.fn(),
}));
jest.mock('@/shared/api/groupsApi', () => ({ getGroupSettings: jest.fn() }));
jest.mock('@/shared/onboarding/StarterTourContext', () => ({
  useStarterTourTarget: () => undefined,
}));

describe('AnalysisBatchCreateScreen', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(listDataSources).mockResolvedValue({ items: sources });
    jest.mocked(listDataSourceGroups).mockResolvedValue({ items: groups });
    jest.mocked(listDataSourceAudioFiles).mockResolvedValue({ items: [] });
    jest.mocked(getAudioRuntime).mockResolvedValue({ mode: 'object_storage' } as never);
    jest.mocked(listAudioAnalysisBatches).mockResolvedValue({ items: [] });
    jest.mocked(getGroupSettings).mockResolvedValue({
      analysis: { contentFocus: 'focus', tone: 'tone', customTags: [] },
    } as never);
    jest.mocked(getDataSource).mockResolvedValue({
      id: 'source-1',
      settings: { customBusinessRoles: ['售后'] },
    } as never);
    jest.mocked(updateDataSource).mockImplementation(
      async (_id, input) =>
        ({
          id: 'source-1',
          settings: { customBusinessRoles: input.customBusinessRoles ?? [] },
        }) as never,
    );
  });

  it('uses bottom sheets for long source and group lists', async () => {
    const screen = render(<AnalysisBatchCreateScreen />);

    expect(await screen.findByText('数据源 1')).toBeTruthy();
    expect(await screen.findByText('分组 1')).toBeTruthy();
    expect(screen.queryByText('数据源 5')).toBeNull();
    expect(screen.queryByRole('button', { name: /展开其余/ })).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: '选择数据源' }));
    expect(await screen.findByRole('button', { name: '数据源 5' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '数据源 5' }));
    await waitFor(() => expect(screen.getByText('数据源 5')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '选择分析分组' }));
    expect(await screen.findByRole('button', { name: '分组 6' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '分组 6' }));
    await waitFor(() => expect(screen.getByText('分组 6')).toBeTruthy());
  });

  it('does not show an expander when all choices fit within four items', async () => {
    jest.mocked(listDataSources).mockResolvedValue({ items: sources.slice(0, 4) });
    jest.mocked(listDataSourceGroups).mockResolvedValue({ items: groups.slice(0, 4) });
    const screen = render(<AnalysisBatchCreateScreen />);

    expect(await screen.findByText('数据源 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /展开其余/ })).toBeNull();
  });

  it('explains the server handoff and waits for confirmation before creating a batch', async () => {
    jest.mocked(listDataSourceAudioFiles).mockResolvedValue({ items: [existingAudio] });
    jest.mocked(createExistingAudioAnalysisBatch).mockResolvedValue({
      batch: { id: 'batch-1' },
    } as never);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = render(<AnalysisBatchCreateScreen />);

    expect(await screen.findByText('上传完成后可关闭 App，服务器会继续处理')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '了解更多' }));
    expect(await screen.findByText(/三种模式都支持上传完成/)).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: '已有音频' }));
    fireEvent.press(await screen.findByRole('checkbox', { name: '已上传音频' }));
    fireEvent.press(screen.getByRole('button', { name: '开始分析' }));

    expect(createExistingAudioAnalysisBatch).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      '确认开始分析',
      expect.stringContaining('只有上传完成并成功创建/提交服务端任务后'),
      expect.any(Array),
    );

    const confirmationButtons = alert.mock.calls.at(-1)?.[2];
    act(() => {
      confirmationButtons?.[1]?.onPress?.();
    });

    await waitFor(() => expect(createExistingAudioAnalysisBatch).toHaveBeenCalled());
  });

  it('exposes the default analysis workflow inside more settings', async () => {
    const screen = render(
      <AnalysisPreferenceProvider>
        <AnalysisBatchCreateScreen />
      </AnalysisPreferenceProvider>,
    );

    fireEvent.press(await screen.findByRole('button', { name: '更多设置' }));
    const transcriptionOnly = await screen.findByRole('radio', { name: '仅转写' });

    // 默认全流程；就地切换后写入与录音页共用的同一偏好。
    expect(screen.getByRole('radio', { name: '全流程分析' }).props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    fireEvent.press(transcriptionOnly);

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: '仅转写' }).props.accessibilityState).toEqual(
        expect.objectContaining({ checked: true }),
      ),
    );
  });

  it('shows the selected data source role dictionary and persists an added role', async () => {
    jest.mocked(updateDataSource).mockResolvedValueOnce({
      id: 'source-1',
      settings: { customBusinessRoles: ['售后', '技术顾问'] },
    } as never);
    const screen = render(<AnalysisBatchCreateScreen />);

    // 词典属于当前所选数据源，提交分析前即可确认角色白名单。
    expect(await screen.findByText('角色识别词典')).toBeTruthy();
    expect(getDataSource).toHaveBeenCalledWith('source-1');
    expect(screen.getByText('销售')).toBeTruthy();
    expect(screen.getByText('售后')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('新增自定义角色'), '技术顾问');
    fireEvent.press(screen.getByLabelText('添加'));

    await waitFor(() =>
      expect(updateDataSource).toHaveBeenCalledWith('source-1', {
        customBusinessRoles: ['售后', '技术顾问'],
      }),
    );
    expect(await screen.findByText('技术顾问')).toBeTruthy();
  });

  it('follows the selected data source when switching sources', async () => {
    jest.mocked(getDataSource).mockImplementation(
      async (id) =>
        ({
          id,
          settings: { customBusinessRoles: id === 'source-2' ? ['技术顾问'] : ['售后'] },
        }) as never,
    );
    const screen = render(<AnalysisBatchCreateScreen />);
    await screen.findByText('角色识别词典');

    fireEvent.press(screen.getByRole('button', { name: '选择数据源' }));
    fireEvent.press(await screen.findByRole('button', { name: '数据源 2' }));

    await waitFor(() => expect(getDataSource).toHaveBeenCalledWith('source-2'));
    // 切换数据源后词典随之更新，不会残留上一个数据源的角色。
    expect(await screen.findByText('技术顾问')).toBeTruthy();
    expect(screen.queryByText('售后')).toBeNull();
  });
});
