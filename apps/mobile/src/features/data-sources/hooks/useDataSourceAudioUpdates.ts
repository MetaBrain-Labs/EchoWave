/**
 * 数据源音频实时更新 Hook。
 *
 * 维护 SSE 重连、连续失败后的 REST 降级和终态刷新流程。
 *
 * Responsibilities:
 * - 将音频状态事件合并到当前数据源详情投影。
 * - 在连接失败时按既有退避策略重连并启用五秒快照刷新。
 *
 * Notes:
 * - REST 快照仍由 Screen 注入的 load 函数保持权威。
 */
import type { SupportedLanguage } from '@echowave/contracts';
import { useEffect, type Dispatch, type SetStateAction } from 'react';

import { streamDataSourceAudio } from '@/shared/api/liveUpdateStreams';
import { translateTextForLanguage } from '@/shared/i18n/LanguageProvider';
import { localizeRequestError } from '@/shared/i18n/errorLocalization';

import { toSourceAudioItem, type DataSourceDetailView } from '../model';

type DataSourceAudioUpdatesOptions = {
  active: boolean;
  dataSourceId: string;
  hasActiveTranscription: boolean;
  language: SupportedLanguage;
  load: (showLoading?: boolean) => Promise<void>;
  setProgressRefreshError: Dispatch<SetStateAction<string>>;
  setSource: Dispatch<SetStateAction<DataSourceDetailView | undefined>>;
};

/** 订阅数据源音频状态，并在断线时保持有界恢复。 */
export function useDataSourceAudioUpdates({
  active,
  dataSourceId,
  hasActiveTranscription,
  language,
  load,
  setProgressRefreshError,
  setSource,
}: DataSourceAudioUpdatesOptions): void {
  useEffect(() => {
    if (!hasActiveTranscription || !active) return undefined;
    let disposed = false;
    let controller: AbortController | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    let failures = 0;
    const retryDelays = [1_000, 2_000, 5_000, 10_000];
    const stopFallback = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = undefined;
    };
    const startFallback = () => {
      if (fallbackTimer) return;
      void load(false);
      fallbackTimer = setInterval(() => void load(false), 5_000);
    };
    const connect = async () => {
      controller = new AbortController();
      try {
        await streamDataSourceAudio({
          dataSourceId,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'error') {
              setProgressRefreshError(
                translateTextForLanguage(language, 'sourceDetail.progressRefreshFailed', {
                  message: localizeRequestError(event.error.code, event.error.message),
                }),
              );
              return;
            }
            failures = 0;
            stopFallback();
            setProgressRefreshError('');
            if (event.type === 'snapshot') {
              setSource((current) =>
                current
                  ? {
                      ...current,
                      audioItems: event.items.map((item) => toSourceAudioItem(item, language)),
                    }
                  : current,
              );
              return;
            }
            if (event.type === 'audio-file') {
              setSource((current) => {
                if (!current) return current;
                if (!event.item) {
                  return {
                    ...current,
                    audioItems: current.audioItems.filter((item) => item.id !== event.audioFileId),
                  };
                }
                const next = toSourceAudioItem(event.item, language);
                const exists = current.audioItems.some((item) => item.id === next.id);
                return {
                  ...current,
                  audioItems: exists
                    ? current.audioItems.map((item) => (item.id === next.id ? next : item))
                    : [next, ...current.audioItems],
                };
              });
              if (event.terminal) void load(false);
              return;
            }
            if (event.type === 'refresh') void load(false);
          },
        });
        if (!disposed) throw new Error('转写实时状态连接已关闭。');
      } catch {
        if (disposed || controller.signal.aborted) return;
        failures += 1;
        if (failures >= 5) {
          setProgressRefreshError(translateTextForLanguage(language, 'sourceDetail.liveFallback'));
          startFallback();
        }
        retryTimer = setTimeout(
          () => void connect(),
          failures >= 5 ? 30_000 : retryDelays[Math.min(failures - 1, retryDelays.length - 1)],
        );
      }
    };
    void connect();
    return () => {
      disposed = true;
      controller?.abort();
      if (retryTimer) clearTimeout(retryTimer);
      stopFallback();
    };
  }, [
    active,
    dataSourceId,
    hasActiveTranscription,
    language,
    load,
    setProgressRefreshError,
    setSource,
  ]);
}
