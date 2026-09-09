/**
 * App 语言 Provider 回归测试。
 *
 * 验证设备 locale 推断、持久设置优先、即时重渲染和保存失败不污染当前语言。
 *
 * Responsibilities:
 * - 锁定首次启动与重启恢复语义。
 * - 锁定中英文目录键一致且没有空值。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import {
  APP_LANGUAGE_STORAGE_KEY,
  inferSupportedLanguage,
  LanguageProvider,
  useAppLanguage,
} from '../LanguageProvider';
import { en, zhCN } from '../translations';

jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const mockedStorage = jest.mocked(AsyncStorage);
const mockedLocales = jest.mocked(getLocales);

function Probe() {
  const { language, setLanguage, t } = useAppLanguage();
  return (
    <Pressable
      onPress={() => void setLanguage(language === 'zh-CN' ? 'en' : 'zh-CN').catch(() => undefined)}
    >
      <Text>{`${language}|${t('tabs.more')}`}</Text>
    </Pressable>
  );
}

function IndependentAnalysisProbe() {
  const { language, setLanguage } = useAppLanguage();
  const [analysisLanguage, setAnalysisLanguage] = useState(language);
  return (
    <>
      <Text>{`${language}|${analysisLanguage}`}</Text>
      <Pressable accessibilityLabel="change-analysis" onPress={() => setAnalysisLanguage('en')} />
      <Pressable accessibilityLabel="change-app" onPress={() => void setLanguage('en')} />
    </>
  );
}

describe('LanguageProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStorage.getItem.mockResolvedValue(null);
    mockedStorage.setItem.mockResolvedValue(undefined);
    mockedLocales.mockReturnValue([{ languageTag: 'en-US' }] as unknown as ReturnType<
      typeof getLocales
    >);
  });

  it('maps all Chinese locales to zh-CN and unknown locales to English', () => {
    expect(inferSupportedLanguage('zh-Hant-TW')).toBe('zh-CN');
    expect(inferSupportedLanguage('en-GB')).toBe('en');
    expect(inferSupportedLanguage('fr-FR')).toBe('en');
  });

  it('prefers a valid stored language and persists an immediate switch', async () => {
    mockedStorage.getItem.mockResolvedValue('zh-CN');
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    await screen.findByText('zh-CN|更多');
    fireEvent.press(screen.getByText('zh-CN|更多'));
    await screen.findByText('en|More');
    expect(mockedStorage.setItem).toHaveBeenCalledWith(APP_LANGUAGE_STORAGE_KEY, 'en');
  });

  it('recovers an invalid stored value from the locale', async () => {
    mockedStorage.getItem.mockResolvedValue('broken');
    mockedLocales.mockReturnValue([{ languageTag: 'zh-SG' }] as unknown as ReturnType<
      typeof getLocales
    >);
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    await screen.findByText('zh-CN|更多');
  });

  it('keeps the current language when persistence fails', async () => {
    mockedStorage.setItem.mockRejectedValue(new Error('storage failed'));
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    await screen.findByText('en|More');
    await act(async () => {
      fireEvent.press(screen.getByText('en|More'));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('en|More')).toBeTruthy());
  });

  it('keeps translation directories structurally identical and non-empty', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
    expect(Object.values(en).every(Boolean)).toBe(true);
    expect(Object.values(zhCN).every(Boolean)).toBe(true);
  });

  it('keeps a form analysis language independent after its App-language default is initialized', async () => {
    mockedStorage.getItem.mockResolvedValue('zh-CN');
    render(
      <LanguageProvider>
        <IndependentAnalysisProbe />
      </LanguageProvider>,
    );
    await screen.findByText('zh-CN|zh-CN');

    fireEvent.press(screen.getByLabelText('change-analysis'));
    await screen.findByText('zh-CN|en');
    expect(mockedStorage.setItem).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('change-app'));
    await screen.findByText('en|en');
    expect(mockedStorage.setItem).toHaveBeenCalledWith(APP_LANGUAGE_STORAGE_KEY, 'en');
  });
});
