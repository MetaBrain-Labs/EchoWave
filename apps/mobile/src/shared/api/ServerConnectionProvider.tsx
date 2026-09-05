/**
 * EchoWave Server 运行时连接状态。
 *
 * 从设备偏好中恢复服务器地址，并让根布局和设置页面共享保存、重试与切换生命周期。
 *
 * Responsibilities:
 * - 使用 AsyncStorage 持久化非敏感服务器 URL。
 * - 在业务路由挂载前完成连接地址水合。
 * - 通过 revision 让服务器切换触发完整业务视图重建。
 *
 * Notes:
 * - 服务端数据不写入此存储；PostgreSQL 仍是业务事实来源。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { getDevelopmentServerUrl, normalizeServerUrl, setRuntimeServerUrl } from './serverUrl';

export const SERVER_URL_STORAGE_KEY = 'echowave.server-url.v1';

type ConnectionPhase = 'error' | 'loading' | 'ready' | 'unconfigured';

type ServerConnectionContextValue = {
  error: string | null;
  phase: ConnectionPhase;
  revision: number;
  serverUrl: string | null;
  retryHydration: () => void;
  saveServerUrl: (serverUrl: string) => Promise<void>;
};

const ServerConnectionContext = createContext<ServerConnectionContextValue | null>(null);

/** 恢复并维护当前设备选择的 EchoWave Server。 */
export function ServerConnectionProvider({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<ConnectionPhase>('loading');
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(SERVER_URL_STORAGE_KEY)
      .then(async (saved) => {
        if (!active) return;
        let restored: string | null = null;
        if (saved) {
          try {
            restored = normalizeServerUrl(saved);
          } catch {
            await AsyncStorage.removeItem(SERVER_URL_STORAGE_KEY);
          }
        }
        restored ??= getDevelopmentServerUrl();
        if (!active) return;
        setRuntimeServerUrl(restored);
        setServerUrl(restored);
        setPhase(restored ? 'ready' : 'unconfigured');
      })
      .catch(() => {
        if (!active) return;
        setRuntimeServerUrl(null);
        setServerUrl(null);
        setError('无法读取本机服务器设置，请重试。');
        setPhase('error');
      });
    return () => {
      active = false;
    };
  }, [hydrationAttempt]);

  const saveServerUrl = useCallback(async (value: string) => {
    const normalized = normalizeServerUrl(value);
    await AsyncStorage.setItem(SERVER_URL_STORAGE_KEY, normalized);
    setRuntimeServerUrl(normalized);
    setServerUrl(normalized);
    setError(null);
    setPhase('ready');
    setRevision((current) => current + 1);
  }, []);

  const retryHydration = useCallback(() => {
    setPhase('loading');
    setError(null);
    setHydrationAttempt((current) => current + 1);
  }, []);

  const value = useMemo<ServerConnectionContextValue>(
    () => ({
      error,
      phase,
      revision,
      serverUrl,
      retryHydration,
      saveServerUrl,
    }),
    [error, phase, retryHydration, revision, saveServerUrl, serverUrl],
  );

  return (
    <ServerConnectionContext.Provider value={value}>{children}</ServerConnectionContext.Provider>
  );
}

/** 读取根级服务器连接生命周期。 */
export function useServerConnection(): ServerConnectionContextValue {
  const context = useContext(ServerConnectionContext);
  if (!context)
    throw new Error('useServerConnection must be used within ServerConnectionProvider.');
  return context;
}
