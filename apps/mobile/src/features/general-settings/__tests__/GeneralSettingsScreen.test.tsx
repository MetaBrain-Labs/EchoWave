/**
 * 通用设置页面测试。
 *
 * 验证语言设置从“更多”页迁移后仍可切换，并在持久化失败时显示错误而不改变当前语言。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { GeneralSettingsScreen } from '../GeneralSettingsScreen';

const mockSetLanguage = jest.fn<Promise<void>, ['zh-CN' | 'en']>();
const mockTranslations: Record<string, string> = {
  'common.saveFailed': '保存失败',
  'generalSettings.subtitle': '管理应用级偏好设置。',
  'generalSettings.title': '通用设置',
  'language.en': 'English',
  'language.saveError': '无法保存语言设置，已保留原语言。',
  'language.section': '语言 / Language',
  'language.supported': '当前仅支持中文和英文。',
  'language.zhCN': '简体中文',
};

jest.mock('@/shared/i18n/LanguageProvider', () => ({
  useAppLanguage: () => ({
    language: 'zh-CN',
    setLanguage: mockSetLanguage,
    t: (key: string) => mockTranslations[key] ?? key,
  }),
}));

describe('GeneralSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetLanguage.mockResolvedValue(undefined);
  });

  it('renders the moved language setting and changes language through the provider', async () => {
    const screen = render(<GeneralSettingsScreen onBack={jest.fn()} />);

    expect(screen.getByRole('header', { name: '通用设置' })).toBeTruthy();
    expect(screen.getByText('语言 / Language')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('English'));
    });
    expect(mockSetLanguage).toHaveBeenCalledWith('en');
  });

  it('reports persistence errors while keeping the provider language unchanged', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockSetLanguage.mockRejectedValueOnce(new Error('storage unavailable'));
    const screen = render(<GeneralSettingsScreen onBack={jest.fn()} />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('English'));
    });
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('保存失败', '无法保存语言设置，已保留原语言。'),
    );
    expect(screen.getByRole('radio', { name: '简体中文' }).props.accessibilityState).toEqual({
      checked: true,
    });
    alertSpy.mockRestore();
  });
});
