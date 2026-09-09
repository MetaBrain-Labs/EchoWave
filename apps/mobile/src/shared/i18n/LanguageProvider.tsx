/**
 * 应用语言状态与持久化 Provider。
 *
 * 首次启动按设备 locale 推断语言；后续以版本化 AsyncStorage 设置为权威，并在水合完成前
 * 阻止业务界面渲染以避免语言闪烁。
 *
 * Responsibilities:
 * - 推断、读取和持久化 App 语言。
 * - 提供类型安全翻译及显式 locale 的日期数字格式化。
 *
 * Notes:
 * - 分析表单只在初始化时读取此语言，不与表单状态双向绑定。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { I18n } from 'i18n-js';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { SupportedLanguage } from '@echowave/contracts';

import { colors } from '@/shared/theme/tokens';
import { en, type TranslationKey, zhCN } from './translations';
import { setRequestLanguage } from './errorLocalization';

export const APP_LANGUAGE_STORAGE_KEY = '@echowave/app-language/v1';

/** 将设备语言标签映射为首期支持语言；未知语言按产品约定回退英文。 */
export function inferSupportedLanguage(languageTag?: string | null): SupportedLanguage {
  const normalized = languageTag?.trim().toLowerCase() ?? '';
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  return 'en';
}

type LanguageContextValue = {
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
  t: (key: TranslationKey, options?: Record<string, unknown>) => string;
  formatDateTime: (value: Date | string | number) => string;
  formatNumber: (value: number) => string;
};

/** 将类型安全的扁平键目录转换为 i18n-js 使用的嵌套目录。 */
function expandCatalog(catalog: Record<TranslationKey, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, message] of Object.entries(catalog)) {
    const segments = key.split('.');
    let cursor = root;
    for (const segment of segments.slice(0, -1)) {
      const existing = cursor[segment];
      if (typeof existing === 'object' && existing !== null) {
        cursor = existing as Record<string, unknown>;
      } else {
        const nested: Record<string, unknown> = {};
        cursor[segment] = nested;
        cursor = nested;
      }
    }
    cursor[segments.at(-1)!] = message;
  }
  return root;
}

const catalogs = { en: expandCatalog(en), 'zh-CN': expandCatalog(zhCN) };
const fallbackI18n = new I18n(catalogs);
fallbackI18n.locale = 'zh-CN';

/** 在 React 树外按显式语言读取翻译，供展示模型等纯函数使用。 */
export function translateTextForLanguage(
  language: SupportedLanguage,
  key: TranslationKey,
  options?: Record<string, unknown>,
): string {
  const i18n = new I18n(catalogs);
  i18n.locale = language;
  i18n.enableFallback = false;
  return i18n.t(key, options);
}

/** 为 Alert 等 React 树外的同步调用点提供当前语言翻译。 */
export function translateAppText(key: TranslationKey, options?: Record<string, unknown>): string {
  return fallbackI18n.t(key, options);
}
const fallbackContext: LanguageContextValue = {
  language: 'zh-CN',
  setLanguage: async () => undefined,
  t: (key, options) => fallbackI18n.t(key, options),
  formatDateTime: (date) =>
    new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(date),
    ),
  formatNumber: (number) => new Intl.NumberFormat('zh-CN').format(number),
};
const LanguageContext = createContext<LanguageContextValue>(fallbackContext);

/** 为移动端提供已完成水合的 App 语言。 */
export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<SupportedLanguage>('en');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(APP_LANGUAGE_STORAGE_KEY)
      .then((stored) => {
        if (!active) return;
        const next =
          stored === 'zh-CN' || stored === 'en'
            ? stored
            : inferSupportedLanguage(getLocales()[0]?.languageTag);
        setLanguageState(next);
      })
      .catch(() => {
        if (active) setLanguageState(inferSupportedLanguage(getLocales()[0]?.languageTag));
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (hydrated) {
      fallbackI18n.locale = language;
      setRequestLanguage(language);
    }
  }, [hydrated, language]);

  const setLanguage = useCallback(
    async (next: SupportedLanguage) => {
      if (next === language) return;
      await AsyncStorage.setItem(APP_LANGUAGE_STORAGE_KEY, next);
      setLanguageState(next);
    },
    [language],
  );

  const value = useMemo<LanguageContextValue>(() => {
    const i18n = new I18n(catalogs);
    i18n.locale = language;
    i18n.enableFallback = false;
    return {
      language,
      setLanguage,
      t: (key, options) => i18n.t(key, options),
      formatDateTime: (date) =>
        new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(date),
        ),
      formatNumber: (number) => new Intl.NumberFormat(language).format(number),
    };
  }, [language, setLanguage]);

  if (!hydrated) {
    return (
      <View style={styles.gate} testID="language-hydration-gate">
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** 读取当前 App 语言与本地化工具。 */
export function useAppLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

const styles = StyleSheet.create({
  gate: { alignItems: 'center', backgroundColor: colors.canvas, flex: 1, justifyContent: 'center' },
});
