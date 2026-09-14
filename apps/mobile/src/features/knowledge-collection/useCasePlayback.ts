/**
 * 案例逐轮与连续播放控制器。
 *
 * Responsibilities:
 * - 候选严格播放来源时间范围，正式案例使用独立归档片段。
 * - 同一操作承担暂停与恢复，连续播放跳过轮次之间的无关内容。
 * Notes:
 * - 复用共享播放器，离开页面自动释放音频。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeCase } from '@echowave/contracts';
import { audioPlaybackUrl, getApiUrl } from '@/shared/api/apiUrl';
import { useAudioPlayback } from '@/shared/audio/useAudioPlayback';

/** 服务端受控路径不作为本地文件身份。 */
function sourceUrl(id: string) {
  return id.startsWith('/api/knowledge-cases/') ? `${getApiUrl()}${id}` : audioPlaybackUrl(id);
}
/** 将来源毫秒映射为可回溯的分钟秒钟。 */
export function caseTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
/** 每个播放控制保留自己的模式、当前轮次和失败反馈。 */
export function useCasePlayback(item: KnowledgeCase | undefined) {
  const playback = useAudioPlayback(
    item?.status === 'candidate' ? item.source.audioFileId : undefined,
    sourceUrl,
  );
  const [control, setControl] = useState<string>();
  const [turnId, setTurnId] = useState<string>();
  const pending = useRef<KnowledgeCase['content']['turns']>([]);
  const armed = useRef<string | undefined>(undefined);
  const current = item?.content.turns.find((turn) => turn.segmentId === turnId);
  const available = (turn: KnowledgeCase['content']['turns'][number]) =>
    item?.status === 'candidate'
      ? playback.isLoaded && !playback.error
      : item?.status === 'published' &&
        !!item.media.find((media) => media.segmentId === turn.segmentId && media.status === 'ready')
          ?.url;
  /** 不对未知角色编造配对；连续回听只使用当前筛选的真实轮次。 */
  const start = useCallback((turn: KnowledgeCase['content']['turns'][number]) => {
    setTurnId(turn.segmentId);
    armed.current = undefined;
    if (item?.status === 'candidate')
      void playback.playRange({
        key: turn.segmentId,
        startSeconds: turn.startMs / 1000,
        endSeconds: turn.endMs / 1000,
      });
    else {
      const url = item?.media.find((media) => media.segmentId === turn.segmentId)?.url;
      if (url) playback.toggleAudio(url);
    }
  }, [item, playback]);
  useEffect(() => {
    if (playback.error) {
      pending.current = [];
      armed.current = undefined;
      return;
    }
    if (!current) return;
    if (playback.isPlaying && !playback.didJustFinish) armed.current = current.segmentId;
    const ended =
      item?.status === 'candidate'
        ? playback.currentTime + 0.02 >= current.endMs / 1000
        : playback.didJustFinish;
    if (!ended || armed.current !== current.segmentId) return;
    armed.current = undefined;
    pending.current.shift();
    const next = pending.current[0];
    if (next) void Promise.resolve().then(() => start(next));
  }, [current, item, playback, start]);
  /** 点击正在活动的控制暂停，再次点击从当前轮次恢复。 */
  const toggle = (key: string, turns: KnowledgeCase['content']['turns']) => {
    if (!turns.length || turns.some((turn) => !available(turn))) return;
    if (control === key && current) {
      if (playback.isPlaying) {
        start(current);
        return;
      }
      const ended =
        item?.status === 'candidate'
          ? playback.currentTime >= current.endMs / 1000
          : playback.didJustFinish;
      if (!ended) {
        start(current);
        return;
      }
    }
    setControl(key);
    pending.current = turns;
    start(turns[0]);
  };
  /** 候选重载原文件后先定位当前证据，不能从整份音频开头播放。 */
  const retry = async () => {
    if (item?.status !== 'candidate') {
      playback.retry(true);
      return;
    }
    const turn = current ?? item.content.turns[0];
    if (!turn) return;
    setTurnId(turn.segmentId);
    playback.retry(false);
    await playback.seekTo(turn.startMs / 1000);
    await playback.playRange({
      key: turn.segmentId,
      startSeconds: turn.startMs / 1000,
      endSeconds: turn.endMs / 1000,
    });
  };
  return { playback, control, turnId, available, toggle, retry: () => void retry() };
}
