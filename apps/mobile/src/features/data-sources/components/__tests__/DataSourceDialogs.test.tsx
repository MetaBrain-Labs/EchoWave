/**
 * 数据源表单后置角色字典测试。
 *
 * 验证核心角色只读、自定义角色规范化、去重、删除与保存行为。
 *
 * Responsibilities:
 * - 覆盖角色识别字典的移动端编辑边界。
 *
 * Notes:
 * - 服务端共享契约仍是最终可信校验边界。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { DataSourceFormSheet } from '../DataSourceDialogs';

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
