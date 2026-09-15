/**
 * 应用默认分析方式偏好。
 *
 * 仅决定后续表单提交的流程，不修改服务端已有任务快照。
 *
 * Responsibilities:
 * - 水合并持久化全流程或仅转写偏好。
 *
 * Notes:
 * - 保存失败保留先前选择，不需要服务器管理口令。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';

export type AnalysisPreference = 'full' | 'transcription_only';
export const ANALYSIS_PREFERENCE_KEY = '@echowave/analysis-preference/v1';
const AnalysisPreferenceContext = createContext({
  preference: 'full' as AnalysisPreference,
  hydrated: true,
  setPreference: async (_value: AnalysisPreference) => {},
});
/** 提供持久化完成后才生效的应用级分析偏好。 */
export function AnalysisPreferenceProvider({ children }: PropsWithChildren) {
  const [preference, setValue] = useState<AnalysisPreference>('full');
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(ANALYSIS_PREFERENCE_KEY)
      .then((value) => {
        if (active && value === 'transcription_only') setValue(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const setPreference = async (value: AnalysisPreference) => {
    await AsyncStorage.setItem(ANALYSIS_PREFERENCE_KEY, value);
    setValue(value);
  };
  return (
    <AnalysisPreferenceContext.Provider value={{ preference, hydrated, setPreference }}>
      {children}
    </AnalysisPreferenceContext.Provider>
  );
}
/** 新建表单在提交时读取偏好并冻结为服务端流水线选项。 */
export const useAnalysisPreference = () => useContext(AnalysisPreferenceContext);
/** 生成与共享契约兼容的明确流水线选项。 */
export function pipelineForPreference(preference: AnalysisPreference) {
  return {
    confirmation: preference === 'full' ? ('system_raw_snapshot' as const) : ('manual' as const),
    includeEmotion: preference === 'full',
    includeRole: preference === 'full',
    includeBusinessAnalysis: preference === 'full',
    transcriptPolicy: 'reuse_or_create' as const,
  };
}
