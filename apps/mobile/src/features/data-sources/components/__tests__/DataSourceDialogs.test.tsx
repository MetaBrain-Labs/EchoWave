/**
 * 数据源弹层交互与布局测试。
 *
 * 验证核心角色字典行为，以及转写选项在窄屏弹层中保持可读高度和滚动边界。
 *
 * Responsibilities:
 * - 覆盖角色识别字典的移动端编辑边界。
 * - 防止纵向转写选项被弹性布局压缩为空白边框。
 *
 * Notes:
 * - 服务端共享契约仍是最终可信校验边界。
 */
import { fireEvent, render } from '@testing-library/react-native';
import { AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES } from '@echowave/contracts';
import { StyleSheet } from 'react-native';

import {
  AudioTranscriptionConfirmDialog,
  DataSourceFormSheet,
  LightweightUploadConfirmDialog,
} from '../DataSourceDialogs';

describe('DataSourceFormSheet custom business roles', () => {
  it('extends immutable core roles with normalized custom roles', () => {
    const onSubmit = jest.fn();
    const screen = render(
      <DataSourceFormSheet
        error=""
        initialValue={{
          name: '访谈录音',
          description: '',
          customBusinessRoles: ['售后'],
        }}
        mode="edit"
        onClose={jest.fn()}
        onSubmit={onSubmit}
        pending={false}
        transcriptionModel="qwen-audio-3.0-asr-flash-filetrans"
        visible
      />,
    );

    expect(screen.getByText(/核心角色：销售、客户、其他、未知/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('新增自定义业务角色'), '  技术顾问  ');
    fireEvent.press(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByText('技术顾问')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('新增自定义业务角色'), '销售');
    fireEvent.press(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByText(/核心角色已默认包含/)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('删除自定义角色：售后'));
    fireEvent.press(screen.getByRole('button', { name: '确认' }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: '访谈录音',
      description: '',
      customBusinessRoles: ['技术顾问'],
    });
  });
});

describe('AudioTranscriptionConfirmDialog layout', () => {
  it('keeps preprocessing and segmentation rows readable inside a scrollable dialog', () => {
    const onExpectedSpeakerCountChange = jest.fn();
    const screen = render(
      <AudioTranscriptionConfirmDialog
        audioTitle="测试录音"
        expectedSpeakerCount=""
        models={AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES.map((model) => ({
          ...model,
          available: true,
          unavailableReason: null,
        }))}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        onExpectedSpeakerCountChange={onExpectedSpeakerCountChange}
        onPreprocessingChange={jest.fn()}
        pending={false}
        preprocessing="silero_vad"
        sileroVad={{ model: 'silero-vad-v6.2.1', available: true, unavailableReason: null }}
        visible
      />,
    );

    const vadOption = screen.getByRole('radio', { name: '空闲音频过滤（Silero VAD）' });
    const vadStyle = StyleSheet.flatten(vadOption.props.style);
    expect(vadStyle.flex).toBeUndefined();
    expect(vadStyle.minHeight).toBe(68);
    expect(screen.getByText('仅压缩连续超过 30 秒的非人声区间')).toBeTruthy();
    expect(screen.getByText('按说话轮次')).toBeTruthy();
    expect(screen.getByText('说话人变化或明显停顿时开始新段')).toBeTruthy();
    const speakerCount = screen.getByLabelText('预计说话人数');
    fireEvent.changeText(speakerCount, '3 people');
    expect(onExpectedSpeakerCountChange).toHaveBeenCalledWith('3');
    expect(screen.getByText(/仅作为 Speaker 数量软提示/)).toBeTruthy();
  });
});

describe('LightweightUploadConfirmDialog', () => {
  it('shows acoustic analysis selected by default and explains the permanent opt-out', () => {
    const onChange = jest.fn();
    const screen = render(
      <LightweightUploadConfirmDialog
        includeAcousticEmotion
        onCancel={jest.fn()}
        onChange={onChange}
        onConfirm={jest.fn()}
        pending={false}
        visible
      />,
    );
    const checkbox = screen.getByRole('checkbox', { name: '同时进行声学情绪分析' });
    expect(checkbox.props.accessibilityState.checked).toBe(true);
    fireEvent.press(checkbox);
    expect(onChange).toHaveBeenCalledWith(false);

    screen.rerender(
      <LightweightUploadConfirmDialog
        includeAcousticEmotion={false}
        onCancel={jest.fn()}
        onChange={onChange}
        onConfirm={jest.fn()}
        pending={false}
        visible
      />,
    );
    expect(screen.getByText(/必须重新选择原文件并新建 ASR Run/)).toBeTruthy();
  });
});
