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
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Alert, StyleSheet } from 'react-native';
import {
  AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
  DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
} from '@echowave/contracts';
import type { DataSourceAudioStreamEvent } from '@echowave/contracts';

import { DataSourceDetailScreen } from '../DataSourceDetailScreen';
import * as dataSourcesApi from '@/shared/api/dataSourcesApi';
import * as audioAnalysisApi from '@/shared/api/audioAnalysisApi';
import * as groupsApi from '@/shared/api/groupsApi';
import * as liveUpdateApi from '@/shared/api/liveUpdateStreams';
import {
  audioFixtures,
  dataSourceDetailFixture,
  groupFixture,
  ingestionFixtures,
  linkedGroupFixtures,
} from '@/test/workspaceFixtures';
import { mockAudioPlayers, resetExpoAudioMock } from '@/test/ExpoAudioMock';

jest.mock('@/shared/api/dataSourcesApi', () => ({
  archiveDataSource: jest.fn(),
  archiveDataSourceAudioFile: jest.fn(),
  getDataSource: jest.fn(),
  linkDataSourceGroups: jest.fn(),
  listDataSourceAudioFiles: jest.fn(),
  listDataSourceIngestionRecords: jest.fn(),
  listDataSourceGroups: jest.fn(),
  unlinkDataSourceGroup: jest.fn(),
  updateDataSource: jest.fn(),
  uploadDataSourceAudioFiles: jest.fn(),
}));
jest.mock('@/shared/api/audioAnalysisApi', () => ({
  getAudioTranscriptionCapabilities: jest.fn(),
  startAudioTranscription: jest.fn(),
}));
jest.mock('@/shared/api/groupsApi', () => ({ listGroups: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/shared/api/liveUpdateStreams', () => ({ streamDataSourceAudio: jest.fn() }));

let emitDataSourceStreamEvent: ((event: DataSourceAudioStreamEvent) => void) | undefined;
const workspaceApi = { ...dataSourcesApi, ...audioAnalysisApi, ...groupsApi };

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
    emitDataSourceStreamEvent = undefined;
    jest.mocked(liveUpdateApi.streamDataSourceAudio).mockImplementation(
      ({ onEvent, signal }) =>
        new Promise<void>((resolve) => {
          emitDataSourceStreamEvent = onEvent;
          signal.addEventListener('abort', () => {
            resolve();
          });
        }),
    );
    resetExpoAudioMock();
    jest.mocked(workspaceApi.getDataSource).mockResolvedValue(dataSourceDetailFixture);
    jest.mocked(workspaceApi.getAudioTranscriptionCapabilities).mockResolvedValue({
      defaultModel: DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
      models: AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES.map((model) =>
        model.id === 'qwen-audio-3.0-asr-flash-filetrans'
          ? { ...model, available: true, unavailableReason: null }
          : model,
      ),
      ffmpeg: { configured: true, available: true },
      sileroVad: { model: 'silero-vad-v6.2.1', available: true, unavailableReason: null },
      transcriptionConfigured: true,
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

  it('plays one uploaded audio at a time and switches the active row', async () => {
    const screen = await renderDetail();
    const player = mockAudioPlayers.at(-1)!;
    const first = audioFixtures[0];
    const second = audioFixtures[1];

    fireEvent.press(screen.getAllByLabelText(`播放音频：${first.title}`)[0]);
    await waitFor(() => expect(player.replace).toHaveBeenCalled());
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(screen.getAllByLabelText(`暂停音频：${first.title}`).length).toBeGreaterThan(0);

    fireEvent.press(screen.getAllByLabelText(`播放音频：${second.title}`)[0]);
    expect(player.pause).toHaveBeenCalled();
    expect(player.replace).toHaveBeenCalledTimes(2);
    expect(screen.getAllByLabelText(`暂停音频：${second.title}`).length).toBeGreaterThan(0);
  });

  it('disables playback only for uploading and upload-failed rows', async () => {
    const screen = await renderDetail();
    const uploading = audioFixtures.find((item) => item.status.kind === 'uploading')!;
    const uploadFailed = audioFixtures.find(
      (item) => item.status.kind === 'failed' && item.status.stage === 'upload',
    )!;
    const transcriptionFailed = audioFixtures.find(
      (item) => item.status.kind === 'failed' && item.status.stage === 'transcription',
    )!;

    expect(
      screen.getAllByLabelText(`播放音频：${uploading.title}`)[0].props.accessibilityState,
    ).toEqual({ disabled: true });
    expect(
      screen.getAllByLabelText(`播放音频：${uploadFailed.title}`)[0].props.accessibilityState,
    ).toEqual({ disabled: true });
    expect(
      screen.getAllByLabelText(`播放音频：${transcriptionFailed.title}`)[0].props
        .accessibilityState,
    ).toEqual({ disabled: false });
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
    expect(screen.getAllByText('正在转写').length).toBeGreaterThan(0);

    for (const label of ['上传失败', '转写失败']) {
      for (const node of screen.getAllByText(label)) {
        expect(['#000000', '#5A6472', '#A3A3A3']).toContain(
          StyleSheet.flatten(node.props.style)?.color,
        );
      }
    }
  });

  it('shows chunk activity on the card and opens the detailed progress timeline', async () => {
    const screen = await renderDetail();

    expect(screen.getAllByText('模型转写 · Chunk 2/4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('网络尝试 1/3').length).toBeGreaterThan(0);
    fireEvent.press(screen.getAllByLabelText('查看转写进度')[0]!);

    expect(screen.getByRole('header', { name: '转写进度' })).toBeTruthy();
    expect(screen.getByText('Chunk 2/4 · 3:58–8:00')).toBeTruthy();
    expect(screen.getByText('Chunk 1')).toBeTruthy();
    expect(screen.getByText('Chunk 4')).toBeTruthy();
    expect(screen.getAllByText('模型转写').length).toBeGreaterThan(0);
    expect(screen.queryByText(/base64|storage_key|模型正文/)).toBeNull();

    fireEvent.press(screen.getByLabelText('关闭转写进度'));
    expect(screen.queryByRole('header', { name: '转写进度' })).toBeNull();
  });

  it('shows adaptive splitting with the dynamic chunk total', async () => {
    const items = audioFixtures.map((item) =>
      item.status.kind === 'transcribing' && item.status.activity?.stage === 'transcribing'
        ? {
            ...item,
            status: {
              ...item.status,
              progress: 31,
              activity: {
                ...item.status.activity,
                stage: 'splitting' as const,
                chunkIndex: 3,
                chunkCount: 8,
                networkAttempt: null,
                structureAttempt: null,
              },
            },
          }
        : item,
    );
    const expandedItems = items.map((item) =>
      item.status.kind === 'transcribing' && item.status.activity?.stage === 'splitting'
        ? {
            ...item,
            status: {
              ...item.status,
              progress: 32,
              activity: {
                ...item.status.activity,
                stage: 'transcribing' as const,
                chunkCount: 9,
                updatedAt: '2026-08-24T15:00:02.000Z',
              },
            },
          }
        : item,
    );
    jest.mocked(workspaceApi.listDataSourceAudioFiles).mockResolvedValueOnce({ items });
    const screen = await renderDetail();

    expect(screen.getAllByText('Chunk 输出异常，正在细分 · Chunk 3/8').length).toBeGreaterThan(0);
    fireEvent.press(screen.getAllByLabelText('查看转写进度')[0]!);
    expect(screen.getByText('Chunk 输出异常，正在细分')).toBeTruthy();
    expect(screen.getByText('Chunk 8')).toBeTruthy();
    expect(screen.getAllByText('模型转写').length).toBeGreaterThan(0);
    await waitFor(() => expect(emitDataSourceStreamEvent).toBeDefined());
    act(() =>
      emitDataSourceStreamEvent?.({
        type: 'snapshot',
        cursor: '2',
        occurredAt: '2026-08-30T01:00:00.000Z',
        dataSourceId: dataSourceDetailFixture.id,
        items: expandedItems,
      }),
    );
    await waitFor(
      () => expect(screen.getAllByText('模型转写 · Chunk 3/9').length).toBeGreaterThan(0),
      {
        timeout: 3_500,
      },
    );
    expect(screen.getByText('Chunk 9')).toBeTruthy();
  });

  it('keeps the last progress when the stream reports an error and supports a manual refresh', async () => {
    jest.mocked(workspaceApi.listDataSourceAudioFiles).mockResolvedValue({ items: audioFixtures });
    const screen = await renderDetail();

    await waitFor(() => expect(emitDataSourceStreamEvent).toBeDefined());
    act(() =>
      emitDataSourceStreamEvent?.({
        type: 'error',
        cursor: '2',
        occurredAt: '2026-08-30T01:00:00.000Z',
        error: { code: 'STREAM_UNAVAILABLE', message: 'network offline', retryable: true },
      }),
    );

    await waitFor(() => expect(screen.getByText(/进度刷新失败：network offline/)).toBeTruthy(), {
      timeout: 3_500,
    });
    expect(screen.getAllByText('模型转写 · Chunk 2/4').length).toBeGreaterThan(0);

    jest.mocked(workspaceApi.listDataSourceAudioFiles).mockResolvedValue({ items: audioFixtures });
    fireEvent.press(screen.getByText('立即重试'));
    await waitFor(() => expect(screen.queryByText(/进度刷新失败/)).toBeNull());
  });

  it('opens safe transcription diagnostics and retries through the ASR confirmation', async () => {
    const failed = audioFixtures.find(
      (item) => item.status.kind === 'failed' && item.status.stage === 'transcription',
    )!;
    const screen = await renderDetail();

    fireEvent.press(screen.getAllByLabelText('查看转写失败详情')[0]!);
    expect(screen.getByRole('header', { name: '音频转写失败' })).toBeTruthy();
    expect(screen.getByText('UNSUPPORTED_CODEC')).toBeTruthy();
    expect(screen.getByText('类型：模型输出内容未通过语义校验')).toBeTruthy();
    expect(screen.getByText('分块：2 / 3')).toBeTruthy();
    expect(screen.getByText(/timestamp_out_of_bounds/)).toBeTruthy();
    expect(screen.queryByText(/模型正文|报告路径|storage_key/)).toBeNull();

    fireEvent.press(screen.getByTestId('transcription-error-retry'));
    expect(screen.queryByRole('header', { name: '音频转写失败' })).toBeNull();
    expect(screen.getByText('开始 ASR 转写？')).toBeTruthy();
    fireEvent.press(screen.getByText('确认转写'));
    await waitFor(() =>
      expect(workspaceApi.startAudioTranscription).toHaveBeenCalledWith(failed.id, {
        model: 'qwen-audio-3.0-asr-flash-filetrans',
        preprocessing: 'silero_vad',
        segmentationMode: 'speaker_turn',
      }),
    );
  });

  it('uses the official whole-file retry guidance for a historical provider failure', async () => {
    const items = audioFixtures.map((item) =>
      item.status.kind === 'failed' && item.status.stage === 'transcription'
        ? {
            ...item,
            status: {
              ...item.status,
              code: 'MODEL_UNAVAILABLE',
              message: '原音频的结构化结果超出模型输出限制。',
              retryable: true,
              details: {
                category: 'provider' as const,
                chunkIndex: 1,
                chunkCount: 1,
                structureAttempts: 1,
                issues: [
                  {
                    path: '$',
                    code: 'native_max_tokens',
                    message: '模型输出达到 Token 上限。',
                  },
                ],
                outputLength: 20_000,
                outputSha256: 'b'.repeat(64),
              },
            },
          }
        : item,
    );
    jest.mocked(workspaceApi.listDataSourceAudioFiles).mockResolvedValueOnce({ items });
    const screen = await renderDetail();

    fireEvent.press(screen.getAllByLabelText('查看转写失败详情')[0]!);
    expect(screen.getByText(/可以重新发起 DashScope 整文件转写/)).toBeTruthy();
    expect(screen.getByText(/native_max_tokens/)).toBeTruthy();
  });

  it('shows historical validation details without restoring Chunk guidance', async () => {
    const items = audioFixtures.map((item) =>
      item.status.kind === 'failed' && item.status.stage === 'transcription'
        ? {
            ...item,
            status: {
              ...item.status,
              code: 'INVALID_MODEL_OUTPUT',
              message: '最小音频分块仍出现明显文本退化。',
              retryable: true,
              details: {
                category: 'semantic_validation' as const,
                chunkIndex: 4,
                chunkCount: 12,
                structureAttempts: 3,
                issues: [
                  {
                    path: 'segments.0.text',
                    code: 'repeated_text_loop',
                    message: '模型输出出现大范围重复循环。',
                  },
                  {
                    path: 'segments.0.text',
                    code: 'markdown_artifact',
                    message: '模型转写正文包含不应出现的 Markdown 标记。',
                  },
                ],
                outputLength: 16_000,
                outputSha256: 'c'.repeat(64),
              },
            },
          }
        : item,
    );
    jest.mocked(workspaceApi.listDataSourceAudioFiles).mockResolvedValueOnce({ items });
    const screen = await renderDetail();

    fireEvent.press(screen.getAllByLabelText('查看转写失败详情')[0]!);
    expect(screen.getByText(/可以重新发起 DashScope 整文件转写/)).toBeTruthy();
    expect(screen.getByText(/repeated_text_loop/)).toBeTruthy();
    expect(screen.getByText(/markdown_artifact/)).toBeTruthy();
    expect(screen.queryByText(/\*一万\*|模型正文|storage_key/)).toBeNull();
  });

  it('shows a compatible fallback when an old failure has no diagnostics', async () => {
    const items = audioFixtures.map((item) =>
      item.status.kind === 'failed' && item.status.stage === 'transcription'
        ? { ...item, status: { ...item.status, details: null } }
        : item,
    );
    jest.mocked(workspaceApi.listDataSourceAudioFiles).mockResolvedValueOnce({ items });
    const screen = await renderDetail();

    fireEvent.press(screen.getAllByLabelText('查看转写失败详情')[0]!);
    expect(screen.getByText(/没有更详细的结构化诊断/)).toBeTruthy();
    fireEvent.press(screen.getByText('关闭'));
    expect(screen.queryByRole('header', { name: '音频转写失败' })).toBeNull();
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
    expect(
      screen.getByRole('radio', { name: '空闲音频过滤（Silero VAD）' }).props.accessibilityState,
    ).toEqual({ checked: true, disabled: false });
    expect(screen.getByLabelText(/Qwen Audio 3.0 ASR Flash Filetrans/)).toBeTruthy();
    expect(screen.queryByText(/普通分段|直接发送/)).toBeNull();
    expect(screen.getByText(/¥0.00022\/秒/)).toBeTruthy();
    expect(screen.getByText(/Speaker：尽力分离/)).toBeTruthy();
    fireEvent.press(screen.getByText('确认转写'));
    await waitFor(() =>
      expect(workspaceApi.startAudioTranscription).toHaveBeenCalledWith(audioFixtures[0].id, {
        model: 'qwen-audio-3.0-asr-flash-filetrans',
        preprocessing: 'silero_vad',
        segmentationMode: 'speaker_turn',
      }),
    );

    fireEvent.press(screen.getAllByLabelText(`${audioFixtures[0].title}更多操作`)[0]!);
    fireEvent.press(screen.getByText('ASR结果分析'));
    fireEvent.press(screen.getByRole('button', { name: linkedGroupFixtures[0].name }));
    expect(onOpenAudio).toHaveBeenCalledWith(audioFixtures[0].id, linkedGroupFixtures[0].id);
  });

  it('blocks speaker-turn confirmation when DashScope or OSS is unavailable', async () => {
    jest.mocked(workspaceApi.getAudioTranscriptionCapabilities).mockResolvedValueOnce({
      defaultModel: DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
      models: [...AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES],
      ffmpeg: { configured: true, available: true },
      sileroVad: {
        model: 'silero-vad-v6.2.1',
        available: false,
        unavailableReason: 'Silero VAD unavailable.',
      },
      transcriptionConfigured: false,
    });
    const screen = await renderDetail();
    fireEvent.press(screen.getAllByLabelText(`${audioFixtures[0].title}更多操作`)[0]!);
    fireEvent.press(screen.getByText('ASR转写'));

    expect(
      screen.getAllByText(/需要完整配置 DashScope、北京地域 OSS 和 FFmpeg/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '确认转写' }).props.accessibilityState).toEqual({
      disabled: true,
    });
    fireEvent.press(screen.getByText('确认转写'));
    expect(workspaceApi.startAudioTranscription).not.toHaveBeenCalled();
  });

  it('requires an explicit whole-file selection when Silero VAD is unavailable', async () => {
    jest.mocked(workspaceApi.getAudioTranscriptionCapabilities).mockResolvedValueOnce({
      defaultModel: DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
      models: AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES.map((model) => ({
        ...model,
        available: true,
        unavailableReason: null,
      })),
      ffmpeg: { configured: true, available: true },
      sileroVad: {
        model: 'silero-vad-v6.2.1',
        available: false,
        unavailableReason: 'Silero VAD unavailable.',
      },
      transcriptionConfigured: true,
    });
    const screen = await renderDetail();
    fireEvent.press(screen.getAllByLabelText(`${audioFixtures[0].title}更多操作`)[0]!);
    fireEvent.press(screen.getByText('ASR转写'));

    expect(screen.getByRole('button', { name: '确认转写' }).props.accessibilityState).toEqual({
      disabled: true,
    });
    fireEvent.press(screen.getByLabelText('保留完整音频'));
    fireEvent.press(screen.getByText('确认转写'));
    await waitFor(() =>
      expect(workspaceApi.startAudioTranscription).toHaveBeenCalledWith(audioFixtures[0].id, {
        model: 'qwen-audio-3.0-asr-flash-filetrans',
        preprocessing: 'whole_file',
        segmentationMode: 'speaker_turn',
      }),
    );
  });

  it('blocks transcription when the capability and model catalog fails to load', async () => {
    jest
      .mocked(workspaceApi.getAudioTranscriptionCapabilities)
      .mockRejectedValueOnce(new Error('offline'));
    const screen = await renderDetail();

    fireEvent.press(screen.getAllByLabelText(`${audioFixtures[0].title}更多操作`)[0]!);
    fireEvent.press(screen.getByText('ASR转写'));
    expect(screen.getByText('转写模型目录加载失败，请关闭后重试。')).toBeTruthy();
    fireEvent.press(screen.getByText('确认转写'));
    expect(workspaceApi.startAudioTranscription).not.toHaveBeenCalled();
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
