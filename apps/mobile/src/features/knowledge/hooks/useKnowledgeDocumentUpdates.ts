/**
 * 知识文档实时更新 Hook。
 *
 * 维护文档入库 SSE、重连退避和连续失败后的 REST 快照降级。
 *
 * Responsibilities:
 * - 合并文档快照与单文档终态事件。
 * - 在终态发布后刷新知识库聚合详情。
 *
 * Notes:
 * - Hook 不持久化文档事实，服务端快照始终权威。
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react';

import type { KnowledgeBaseDetail, KnowledgeDocument } from '@echowave/contracts';

import { streamKnowledgeDocuments } from '@/shared/api/liveUpdateStreams';
import { localizeRequestError } from '@/shared/i18n/errorLocalization';

import { getKnowledgeBase } from '../apiClient';

type KnowledgeDocumentUpdatesOptions = {
  active: boolean;
  hasProcessingDocuments: boolean;
  knowledgeBaseId: string;
  load: (showLoading?: boolean) => Promise<void>;
  setDocuments: Dispatch<SetStateAction<KnowledgeDocument[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setKnowledge: Dispatch<SetStateAction<KnowledgeBaseDetail | undefined>>;
};

/** 订阅知识文档处理事件并保持有界断线恢复。 */
export function useKnowledgeDocumentUpdates({
  active,
  hasProcessingDocuments,
  knowledgeBaseId,
  load,
  setDocuments,
  setError,
  setKnowledge,
}: KnowledgeDocumentUpdatesOptions): void {
  useEffect(() => {
    if (!hasProcessingDocuments || !active) return undefined;
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
        await streamKnowledgeDocuments({
          knowledgeBaseId,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'error') {
              setError(localizeRequestError(event.error.code, event.error.message));
              return;
            }
            failures = 0;
            stopFallback();
            if (event.type === 'snapshot') {
              setError('');
              setDocuments(event.items);
              return;
            }
            if (event.type !== 'document') return;
            setError('');
            setDocuments((items) => {
              if (!event.item) return items;
              const next = event.item;
              const exists = items.some((item) => item.id === next.id);
              return exists
                ? items.map((item) => (item.id === next.id ? next : item))
                : [next, ...items];
            });
            if (event.terminal) {
              void getKnowledgeBase(knowledgeBaseId)
                .then(setKnowledge)
                .catch(() => undefined);
            }
          },
        });
        if (!disposed) throw new Error('文档实时状态连接已关闭。');
      } catch {
        if (disposed || controller.signal.aborted) return;
        failures += 1;
        if (failures >= 5) startFallback();
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
  }, [active, hasProcessingDocuments, knowledgeBaseId, load, setDocuments, setError, setKnowledge]);
}
