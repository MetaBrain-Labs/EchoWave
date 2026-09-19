/**
 * 配置中心管理员会话。
 *
 * 让 AI 配置、服务配置与运行模式共用一个内存口令，避免管理员在同一服务器上重复输入。
 *
 * Responsibilities:
 * - 仅在本进程内存保存已校验的管理员口令。
 * - 服务器地址 revision 变化时立即失效，避免把口令带给另一台服务器。
 *
 * Notes:
 * - 口令是敏感凭据，禁止写入 AsyncStorage、日志或任何持久化层。
 * - 服务端仍是唯一授权方；本 Provider 只缓存校验结果，不代替每次请求的 Bearer 校验。
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

type AdminSessionContextValue = {
  token: string | null;
  setSession: (token: string) => void;
  clearSession: () => void;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

/** 提供按服务器隔离的内存管理员会话。 */
export function AdminSessionProvider({
  children,
  serverRevision,
}: PropsWithChildren<{ serverRevision: number }>) {
  const [token, setToken] = useState<string | null>(null);
  const [sessionRevision, setSessionRevision] = useState(serverRevision);

  // 服务器切换会生成新的 revision；旧口令对另一台服务器无效，必须整体作废。
  // 在渲染期同步失效，避免先渲染一帧其他服务器的已校验状态。
  if (sessionRevision !== serverRevision) {
    setSessionRevision(serverRevision);
    setToken(null);
  }

  const setSession = useCallback((value: string) => {
    const candidate = value.trim();
    if (candidate) setToken(candidate);
  }, []);
  const clearSession = useCallback(() => setToken(null), []);

  const value = useMemo<AdminSessionContextValue>(
    () => ({ token, setSession, clearSession }),
    [clearSession, setSession, token],
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

/** 读取当前内存管理员会话；未挂载 Provider 时明确失败，避免页面静默丢失授权。 */
export function useAdminSession(): AdminSessionContextValue {
  const context = useContext(AdminSessionContext);
  if (!context) throw new Error('useAdminSession must be used within AdminSessionProvider.');
  return context;
}
