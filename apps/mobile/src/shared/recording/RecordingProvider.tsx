/**
 * 应用级手机录音控制器。
 *
 * 在路由生命周期之外持有录音实例，先保存原件再允许上传或分析。
 *
 * Responsibilities:
 * - 管理麦克风授权、后台录音、暂停和中断。
 * - 串行持久化草稿，保持页面切换和失败后的可恢复性。
 *
 * Notes:
 * - 不自动上传；服务端任务由用户显式提交。
 */
import {
  AudioModule,
  RecordingPresets,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Paths } from 'expo-file-system';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { configureAudioSession, setRecordingAudioOwnership } from '@/shared/audio/audioSession';
import {
  deleteRecordingDraft,
  readRecordingDrafts,
  recordingFile,
  saveRecordingDraft,
  type RecordingDraft,
} from './recordingStore';

type RecordingContextValue = {
  drafts: RecordingDraft[];
  activeId?: string;
  busy: boolean;
  isRecording: boolean;
  durationMs: number;
  error?: string;
  start: (serverUrl: string, dataSourceId: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  update: (draft: RecordingDraft) => Promise<void>;
  remove: (draft: RecordingDraft) => Promise<void>;
};
const unavailable = async () => {
  throw new Error('RecordingProvider is unavailable');
};
const RecordingContext = createContext<RecordingContextValue>({
  drafts: [],
  busy: false,
  isRecording: false,
  durationMs: 0,
  start: unavailable,
  pause: unavailable,
  resume: unavailable,
  stop: unavailable,
  update: unavailable,
  remove: unavailable,
});

/** 提供仅有一个原生录音实例的应用级上下文。 */
export function RecordingProvider({ children }: PropsWithChildren) {
  const { t } = useAppLanguage();
  const [drafts, setDrafts] = useState<RecordingDraft[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef<RecordingDraft | undefined>(undefined);
  const ending = useRef(false);
  const userPaused = useRef(false);
  const initialized = useRef(false);
  const finishRef = useRef<(interrupted: boolean) => Promise<void>>(unavailable);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const duration = useRef(0);
  const recorder = useAudioRecorder(
    { ...RecordingPresets.HIGH_QUALITY, directory: 'document' },
    (status) => {
      if (
        active.current &&
        !ending.current &&
        (status.isFinished || status.hasError || status.mediaServicesDidReset)
      ) {
        void finishRef
          .current(status.hasError || Boolean(status.mediaServicesDidReset) || !ending.current)
          .catch(() => undefined);
      }
    },
  );
  const status = useAudioRecorderState(recorder, 250);
  useEffect(() => {
    duration.current = Math.max(duration.current, status.durationMillis);
  }, [status.durationMillis]);

  const update = useCallback((draft: RecordingDraft) => {
    const operation = pending.current
      .catch(() => undefined)
      .then(async () => {
        await saveRecordingDraft(draft);
        setDrafts((items) => [draft, ...items.filter((item) => item.id !== draft.id)]);
      });
    pending.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void readRecordingDrafts(() => setError(t('recording.restoreFailed')))
      .then((restored) =>
        setDrafts((current) => [
          ...current,
          ...restored.filter((draft) => !current.some((item) => item.id === draft.id)),
        ]),
      )
      .catch(() => setError(t('recording.restoreFailed')));
  }, [t]);

  const stop = useCallback(
    async (interrupted = false) => {
      const draft = active.current;
      if (!draft || ending.current) return;
      ending.current = true;
      setBusy(true);
      try {
        try {
          await recorder.stop();
        } catch {
          interrupted = true;
        }
        const original = recordingFile(draft);
        await update({
          ...draft,
          state: 'local',
          interrupted,
          durationMs: Math.max(duration.current, recorder.getStatus().durationMillis),
          sizeBytes: original.exists ? original.size : 0,
        });
        active.current = undefined;
        setActiveId(undefined);
        if (interrupted) setError(t('recording.interrupted'));
      } catch {
        setError(t('recording.saveFailed'));
        throw new Error(t('recording.saveFailed'));
      } finally {
        setRecordingAudioOwnership(false);
        await configureAudioSession(() =>
          setAudioModeAsync({
            allowsRecording: false,
            allowsBackgroundRecording: false,
            shouldPlayInBackground: false,
          }),
        ).catch(() => undefined);
        ending.current = false;
        setBusy(false);
      }
    },
    [recorder, t, update],
  );
  useEffect(() => {
    finishRef.current = stop;
  }, [stop]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && active.current && recorder.getStatus().mediaServicesDidReset) {
        void finishRef.current(true).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [recorder]);

  useEffect(() => {
    if (
      active.current &&
      !busy &&
      !ending.current &&
      !userPaused.current &&
      !status.isRecording &&
      duration.current > 0
    ) {
      void finishRef.current(true).catch(() => undefined);
    }
  }, [busy, status.isRecording]);

  useEffect(() => {
    if (!activeId) return;
    const timer = setInterval(() => {
      if (active.current && !ending.current) {
        const next = { ...active.current, durationMs: duration.current };
        active.current = next;
        void update(next).catch(() => setError(t('recording.saveFailed')));
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [activeId, t, update]);

  const start = async (serverUrl: string, dataSourceId: string) => {
    if (active.current || busy || Platform.OS === 'web') return;
    setBusy(true);
    setError(undefined);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error(t('recording.permissionDenied'));
      if (Platform.OS === 'android') {
        const notificationPermission = await requestNotificationPermissionsAsync();
        if (!notificationPermission.granted) {
          throw new Error(t('recording.notificationPermissionDenied'));
        }
      }
      setRecordingAudioOwnership(true);
      await configureAudioSession(() =>
        setAudioModeAsync({
          allowsRecording: true,
          allowsBackgroundRecording: true,
          shouldPlayInBackground: true,
          playsInSilentMode: true,
          interruptionMode: 'doNotMix',
        }),
      );
      await recorder.prepareToRecordAsync();
      const uri = recorder.uri;
      if (!uri?.startsWith(Paths.document.uri)) throw new Error(t('recording.saveFailed'));
      const draft: RecordingDraft = {
        version: 1,
        id:
          globalThis.crypto?.randomUUID?.() ??
          'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.floor(Math.random() * 16);
            return (c === 'x' ? r : (r & 3) | 8).toString(16);
          }),
        title: t('recording.defaultTitle', {
          date: new Date().toISOString().slice(0, 19).replace('T', ' '),
        }),
        createdAt: new Date().toISOString(),
        path: uri.slice(Paths.document.uri.length),
        durationMs: 0,
        sizeBytes: 0,
        serverUrl,
        dataSourceId,
        interrupted: false,
        state: 'recording',
      };
      await update(draft);
      duration.current = 0;
      userPaused.current = false;
      active.current = draft;
      setActiveId(draft.id);
      recorder.record();
    } catch (reason) {
      setRecordingAudioOwnership(false);
      await configureAudioSession(() =>
        setAudioModeAsync({
          allowsRecording: false,
          allowsBackgroundRecording: false,
          shouldPlayInBackground: false,
        }),
      ).catch(() => undefined);
      setError(reason instanceof Error ? reason.message : t('recording.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <RecordingContext.Provider
      value={{
        drafts,
        activeId,
        busy,
        isRecording: status.isRecording,
        durationMs: status.durationMillis,
        error,
        start,
        pause: async () => {
          userPaused.current = true;
          recorder.pause();
        },
        resume: async () => {
          if (active.current && !ending.current) {
            userPaused.current = false;
            recorder.record();
          }
        },
        stop: () => stop(),
        update,
        remove: async (draft) => {
          if (draft.id === active.current?.id) return;
          await pending.current;
          deleteRecordingDraft(draft);
          setDrafts((items) => items.filter((item) => item.id !== draft.id));
        },
      }}
    >
      {children}
    </RecordingContext.Provider>
  );
}

/** 页面消费录音控制器；不创建新的原生录音实例。 */
export const useRecording = () => useContext(RecordingContext);
