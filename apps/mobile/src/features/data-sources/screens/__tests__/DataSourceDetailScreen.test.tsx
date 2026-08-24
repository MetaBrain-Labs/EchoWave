/**
 * 数据源详情页面测试。
 *
 * 验证概览吸顶结构、四页导航、状态表达、固定操作和缺失数据反馈。
 *
 * Responsibilities:
 * - 覆盖数据源详情原型的主要可观察交互。
 *
 * Notes:
 * - 不执行真实上传、转写、播放或关联操作。
 */
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Alert, StyleSheet } from 'react-native';

import { DataSourceDetailScreen } from '../DataSourceDetailScreen';
import * as workspaceApi from '@/shared/api/workspaceApi';
import {
  audioFixtures,
  dataSourceDetailFixture,
  groupFixture,
  ingestionFixtures,
  linkedGroupFixtures,
} from '@/test/workspaceFixtures';

jest.mock('@/shared/api/workspaceApi', () => ({
  archiveDataSource: jest.fn(),
  archiveDataSourceAudioFile: jest.fn(),
  getAudioTranscriptionCapabilities: jest.fn(),
  getDataSource: jest.fn(),
  linkDataSourceGroups: jest.fn(),
  listDataSourceAudioFiles: jest.fn(),
  listDataSourceIngestionRecords: jest.fn(),
  listDataSourceGroups: jest.fn(),
  listGroups: jest.fn(),
  startAudioTranscription: jest.fn(),
  unlinkDataSourceGroup: jest.fn(),
  updateDataSource: jest.fn(),
  uploadDataSourceAudioFiles: jest.fn(),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

async function renderDetail(
  sourceId = dataSourceDetailFixture.id,
  onBack = jest.fn(),
  onOpenAudio = jest.fn(),
) {
  const screen = render(
    <DataSourceDetailScreen onBack={onBack} onOpenAudio={onOpenAudio} sourceId={sourceId} />,
  );
  await waitFor(() => expect(screen.queryByLabelText('正在加载数据源详情')).toBeNull());
  return screen;
}

describe('DataSourceDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(workspaceApi.getDataSource).mockResolvedValue(dataSourceDetailFixture);
    jest.mocked(workspaceApi.getAudioTranscriptionCapabilities).mockResolvedValue({
      ffmpeg: { configured: true, available: true },
      direct: {
        maxBytes: 209_715_200,
        formats: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm'],
      },
    });
    jest.mocked(workspaceApi.listDataSourceAudioFiles).mockResolvedValue({ items: audioFixtures });
    jest
      .mocked(workspaceApi.listDataSourceIngestionRecords)
      .mockResolvedValue({ items: ingestionFixtures });
    jest
      .mocked(workspaceApi.listDataSourceGroups)
      .mockResolvedValue({ items: linkedGroupFixtures });
    jest
      .mocked(DocumentPicker.getDocumentAsync)
      .mockResolvedValue({ canceled: true, assets: null });
    jest.mocked(workspaceApi.uploadDataSourceAudioFiles).mockResolvedValue({
      ingestionRunId: dataSourceDetailFixture.id,
      items: [],
    });
    jest.mocked(workspaceApi.unlinkDataSourceGroup).mockResolvedValue(undefined);
    jest.mocked(workspaceApi.archiveDataSourceAudioFile).mockResolvedValue(undefined);
    jest.mocked(workspaceApi.startAudioTranscription).mockResolvedValue({
      audioFileId: audioFixtures[0].id,
      revisionId: dataSourceDetailFixture.id,
      status: 'queued',
    });
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({
      items: [
        groupFixture,
        {
          ...groupFixture,
          id: '10000000-0000-4000-8000-000000000003',
          name: '新访谈分组',
        },
      ],
    });
    jest.mocked(workspaceApi.linkDataSourceGroups).mockResolvedValue({
      items: linkedGroupFixtures,
    });
  });

  it('renders the overview hero and keeps its tabs sticky after the hero', async () => {
    const screen = await renderDetail();

    expect(screen.getAllByText('团队录音空间')).toHaveLength(2);
    expect(screen.getByText('数据源详情')).toBeTruthy();
    expect(screen.getByText(/最近上传/)).toBeTruthy();
    expect(screen.getByTestId('data-source-overview-scroll').props.stickyHeaderIndices).toEqual([
      1,
    ]);
    expect(screen.getAllByRole('tab', { name: '概览' })[0]?.props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('switches tabs by press and horizontal swipe and updates fixed actions', async () => {
    const screen = await renderDetail();

    fireEvent.press(screen.getAllByRole('tab', { name: '关联分组' })[0]!);
    expect(
      within(screen.getByTestId('data-source-fixed-actions')).getByText('关联新分组'),
    ).toBeTruthy();

    fireEvent(screen.getByTestId('data-source-detail-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 480, y: 0 } },
    });

    expect(screen.getAllByRole('tab', { name: '音频文件' })[0]?.props.accessibilityState).toEqual({
      selected: true,
    });
    const actions = within(screen.getByTestId('data-source-fixed-actions'));
    expect(actions.getByText('全部转写')).toBeTruthy();
    expect(actions.getByText('上传音频')).toBeTruthy();
  });

  it('shows all audio and upload failure states without forbidden text colors', async () => {
    const screen = await renderDetail();

    expect(screen.getAllByText('上传中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('待转写').length).toBeGreaterThan(0);
    expect(screen.getAllByText('上传失败').length).toBeGreaterThan(0);
    expect(screen.getAllByText('转写失败').length).toBeGreaterThan(0);

    for (const label of ['上传失败', '转写失败']) {
      for (const node of screen.getAllByText(label)) {
        expect(['#000000', '#5A6472', '#A3A3A3']).toContain(
          StyleSheet.flatten(node.props.style)?.color,
        );
      }
    }
  });

  it('reopens the file picker for failed uploads while transcription retry stays deferred', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = await renderDetail();

    fireEvent.press(screen.getByLabelText(/重新上传/));
    await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled());
    fireEvent.press(screen.getByLabelText(/重新转写/));

    expect(alert).toHaveBeenCalledWith('功能建设中', '重新转写将在后续版本开放。');
    alert.mockRestore();
  });

  it('uploads selected audio, archives audio, and unlinks groups with confirmation', async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          name: 'customer.wav',
          uri: 'file:///customer.wav',
          mimeType: 'audio/wav',
          size: 1_644,
          lastModified: 0,
        },
      ],
    });
    const screen = await renderDetail();

    fireEvent.press(within(screen.getByTestId('data-source-fixed-actions')).getByText('上传音频'));
    await waitFor(() =>
      expect(workspaceApi.uploadDataSourceAudioFiles).toHaveBeenCalledWith(
        dataSourceDetailFixture.id,
        expect.arrayContaining([expect.objectContaining({ name: 'customer.wav' })]),
      ),
    );

    fireEvent.press(screen.getAllByLabelText(`${audioFixtures[0].title}更多操作`)[0]!);
    fireEvent.press(screen.getByText('归档'));
    fireEvent.press(screen.getByText('归档音频'));
    await waitFor(() =>
      expect(workspaceApi.archiveDataSourceAudioFile).toHaveBeenCalledWith(
        dataSourceDetailFixture.id,
        audioFixtures[0].id,
      ),
    );

    fireEvent.press(screen.getAllByRole('tab', { name: '关联分组' })[0]!);
    fireEvent.press(screen.getByLabelText(`解除关联分组：${linkedGroupFixtures[0].name}`));
    fireEvent.press(screen.getByText('解除关联'));
    await waitFor(() =>
      expect(workspaceApi.unlinkDataSourceGroup).toHaveBeenCalledWith(
        dataSourceDetailFixture.id,
        linkedGroupFixtures[0].id,
      ),
    );
  });

  it('confirms ASR transcription and only opens an available published result', async () => {
    const onOpenAudio = jest.fn();
    const screen = await renderDetail(dataSourceDetailFixture.id, jest.fn(), onOpenAudio);

    fireEvent.press(screen.getAllByLabelText(`${audioFixtures[0].title}更多操作`)[0]!);
    expect(screen.getByText('归档')).toBeTruthy();
    expect(screen.getByText('ASR转写')).toBeTruthy();
    expect(screen.getByText('ASR结果分析')).toBeTruthy();
    fireEvent.press(screen.getByText('ASR转写'));
    expect(screen.getByLabelText('使用 FFmpeg 预处理').props.accessibilityState).toEqual({
      checked: true,
      disabled: false,
    });
    fireEvent.press(screen.getByText('确认转写'));
    await waitFor(() =>
      expect(workspaceApi.startAudioTranscription).toHaveBeenCalledWith(audioFixtures[0].id, {
        preprocessing: 'ffmpeg',
      }),
    );

    fireEvent.press(screen.getAllByLabelText(`${audioFixtures[0].title}更多操作`)[0]!);
    fireEvent.press(screen.getByText('ASR结果分析'));
    expect(onOpenAudio).toHaveBeenCalledWith(audioFixtures[0].id);
  });

  it('allows direct transcription when the user clears the FFmpeg option', async () => {
    const screen = await renderDetail();

    fireEvent.press(screen.getAllByLabelText(`${audioFixtures[0].title}更多操作`)[0]!);
    fireEvent.press(screen.getByText('ASR转写'));
    fireEvent.press(screen.getByLabelText('使用 FFmpeg 预处理'));
    expect(screen.getByText(/原音频将以 base64 直接发送/)).toBeTruthy();
    fireEvent.press(screen.getByText('确认转写'));

    await waitFor(() =>
      expect(workspaceApi.startAudioTranscription).toHaveBeenCalledWith(audioFixtures[0].id, {
        preprocessing: 'direct',
      }),
    );
  });

  it('forces direct mode when FFmpeg capability loading fails', async () => {
    jest
      .mocked(workspaceApi.getAudioTranscriptionCapabilities)
      .mockRejectedValueOnce(new Error('offline'));
    const screen = await renderDetail();

    fireEvent.press(screen.getAllByLabelText(`${audioFixtures[0].title}更多操作`)[0]!);
    fireEvent.press(screen.getByText('ASR转写'));
    expect(screen.getByLabelText('使用 FFmpeg 预处理').props.accessibilityState).toEqual({
      checked: false,
      disabled: true,
    });
    expect(screen.getByText('FFmpeg 未配置或不可用，将直接发送原音频。')).toBeTruthy();
    fireEvent.press(screen.getByText('确认转写'));

    await waitFor(() =>
      expect(workspaceApi.startAudioTranscription).toHaveBeenCalledWith(audioFixtures[0].id, {
        preprocessing: 'direct',
      }),
    );
  });

  it('disables result analysis before a transcript exists', async () => {
    const waiting = audioFixtures.find((item) => item.status.kind === 'waiting')!;
    const screen = await renderDetail();

    fireEvent.press(screen.getAllByLabelText(`${waiting.title}更多操作`)[0]!);
    expect(screen.getByRole('button', { name: 'ASR结果分析' }).props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it('disables linked groups and batch-links a newly selected group', async () => {
    const screen = await renderDetail();
    fireEvent.press(screen.getAllByRole('tab', { name: '关联分组' })[0]!);
    fireEvent.press(
      within(screen.getByTestId('data-source-fixed-actions')).getByText('关联新分组'),
    );

    await waitFor(() => expect(screen.getByText('新访谈分组')).toBeTruthy());
    expect(
      screen.getByLabelText(`已关联分组：${groupFixture.name}`).props.accessibilityState,
    ).toEqual(expect.objectContaining({ checked: true, disabled: true }));
    fireEvent.press(screen.getByLabelText('选择分组：新访谈分组'));
    fireEvent.press(screen.getByText('确认关联'));

    await waitFor(() =>
      expect(workspaceApi.linkDataSourceGroups).toHaveBeenCalledWith(dataSourceDetailFixture.id, {
        groupIds: ['10000000-0000-4000-8000-000000000003'],
      }),
    );
  });

  it('renders an actionable empty state for an unknown source id', async () => {
    const onBack = jest.fn();
    jest.mocked(workspaceApi.getDataSource).mockRejectedValueOnce(new Error('请求的数据不存在。'));
    const screen = await renderDetail('missing', onBack);

    expect(screen.getByText('未找到数据源')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('返回'));
    expect(onBack).toHaveBeenCalled();
  });
});
