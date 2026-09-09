/**
 * 应用级远程推送登记状态。
 *
 * 在服务器地址稳定后检查远程推送能力，并串行完成权限、Expo Token 与服务端设备登记；
 * 状态只保存脱敏诊断，不保存 Token。
 *
 * Responsibilities:
 * - 在启动、切换服务器和 App 回到前台时刷新设备登记。
 * - 向服务状态页暴露阶段、最近尝试时间与手动重试入口。
 *
 * Notes:
 * - 推送不可用不得阻塞主应用或分析任务。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { fetchServerHealth } from '@/shared/api/serverHealth';
import { useServerConnection } from '@/shared/api/ServerConnectionProvider';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { localizeRequestError } from '@/shared/i18n/errorLocalization';

import {
  PushRegistrationError,
  registerPushDevice,
  type PushRegistrationProgress,
} from './pushNotifications';

export type PushRegistrationState = {
  phase:
    | 'checking'
    | 'server_disabled'
    | 'unsupported'
    | 'permission_denied'
    | 'fetching_token'
    | 'registering'
    | 'registered'
    | 'failed';
  message: string;
  serverCapability: 'checking' | 'enabled' | 'disabled' | 'unavailable';
  systemPermission: 'unknown' | 'checking' | 'granted' | 'denied';
  deviceRegistration: 'not_started' | 'registering' | 'registered' | 'failed';
  lastAttemptAt: string | null;
  errorCode: string | null;
  retryable: boolean;
};

type PushNotificationContextValue = {
  state: PushRegistrationState;
  refresh: () => Promise<void>;
};

const initialState: PushRegistrationState = {
  phase: 'checking',
  message: '正在检查远程推送配置。',
  serverCapability: 'checking',
  systemPermission: 'unknown',
  deviceRegistration: 'not_started',
  lastAttemptAt: null,
  errorCode: null,
  retryable: false,
};

const PushNotificationContext = createContext<PushNotificationContextValue | null>(null);

/** 管理当前服务器对应的推送登记生命周期。 */
export function PushNotificationProvider({ children }: PropsWithChildren) {
  const connection = useServerConnection();
  const { language, t } = useAppLanguage();
  const [state, setState] = useState<PushRegistrationState>(() => ({
    ...initialState,
    message: t('push.checking'),
  }));
  const activeRun = useRef<Promise<void> | null>(null);
  const generation = useRef(0);

  const refresh = useCallback((): Promise<void> => {
    if (activeRun.current) return activeRun.current;
    const runGeneration = generation.current;
    const attemptedAt = new Date().toISOString();
    const serverUrl = connection.serverUrl;
    const run = (async () => {
      if (connection.phase !== 'ready' || !serverUrl) {
        setState({
          phase: 'server_disabled',
          message: t('push.connectServer'),
          serverCapability: 'unavailable',
          systemPermission: 'unknown',
          deviceRegistration: 'not_started',
          lastAttemptAt: attemptedAt,
          errorCode: 'SERVER_UNCONFIGURED',
          retryable: false,
        });
        return;
      }
      setState({ ...initialState, message: t('push.checking'), lastAttemptAt: attemptedAt });
      try {
        const health = await fetchServerHealth(serverUrl);
        if (runGeneration !== generation.current) return;
        if (!health.capabilities.remotePush) {
          setState({
            phase: 'server_disabled',
            message: t('push.serverDisabled'),
            serverCapability: 'disabled',
            systemPermission: 'unknown',
            deviceRegistration: 'not_started',
            lastAttemptAt: attemptedAt,
            errorCode: 'REMOTE_PUSH_DISABLED',
            retryable: false,
          });
          return;
        }
        const updateProgress = (progress: PushRegistrationProgress) => {
          if (runGeneration !== generation.current) return;
          if (progress === 'permission') {
            setState({
              phase: 'checking',
              message: t('push.permissionChecking'),
              serverCapability: 'enabled',
              systemPermission: 'checking',
              deviceRegistration: 'not_started',
              lastAttemptAt: attemptedAt,
              errorCode: null,
              retryable: false,
            });
          } else if (progress === 'token') {
            setState({
              phase: 'fetching_token',
              message: t('push.fetchingToken'),
              serverCapability: 'enabled',
              systemPermission: 'granted',
              deviceRegistration: 'not_started',
              lastAttemptAt: attemptedAt,
              errorCode: null,
              retryable: false,
            });
          } else {
            setState({
              phase: 'registering',
              message: t('push.registering'),
              serverCapability: 'enabled',
              systemPermission: 'granted',
              deviceRegistration: 'registering',
              lastAttemptAt: attemptedAt,
              errorCode: null,
              retryable: false,
            });
          }
        };
        const result = await registerPushDevice(
          updateProgress,
          {},
          language,
          t('notifications.channel'),
        );
        if (runGeneration !== generation.current) return;
        if (result.status === 'registered') {
          setState({
            phase: 'registered',
            message: t('push.registered'),
            serverCapability: 'enabled',
            systemPermission: 'granted',
            deviceRegistration: 'registered',
            lastAttemptAt: attemptedAt,
            errorCode: null,
            retryable: false,
          });
        } else if (result.status === 'permission_denied') {
          setState({
            phase: 'permission_denied',
            message: t('push.permissionDenied'),
            serverCapability: 'enabled',
            systemPermission: 'denied',
            deviceRegistration: 'not_started',
            lastAttemptAt: attemptedAt,
            errorCode: 'PUSH_PERMISSION_DENIED',
            retryable: false,
          });
        } else if (result.status === 'unsupported') {
          setState({
            phase: 'unsupported',
            message: t('push.unsupported'),
            serverCapability: 'enabled',
            systemPermission: 'unknown',
            deviceRegistration: 'not_started',
            lastAttemptAt: attemptedAt,
            errorCode: 'PUSH_RUNTIME_UNSUPPORTED',
            retryable: false,
          });
        } else {
          setState({
            phase: 'failed',
            message: t('push.missingProject'),
            serverCapability: 'enabled',
            systemPermission: 'granted',
            deviceRegistration: 'failed',
            lastAttemptAt: attemptedAt,
            errorCode: 'EAS_PROJECT_ID_MISSING',
            retryable: false,
          });
        }
      } catch (error) {
        if (runGeneration !== generation.current) return;
        const known = error instanceof PushRegistrationError;
        setState({
          phase: 'failed',
          message: known ? localizeRequestError(error.code, error.message) : t('push.failed'),
          serverCapability: known ? 'enabled' : 'unavailable',
          systemPermission:
            known &&
            error.code !== 'NATIVE_SETUP_FAILED' &&
            error.code !== 'PUSH_PERMISSION_CHECK_FAILED'
              ? 'granted'
              : 'unknown',
          deviceRegistration: 'failed',
          lastAttemptAt: attemptedAt,
          errorCode: known ? error.code : 'PUSH_REGISTRATION_FAILED',
          retryable: known ? error.retryable : true,
        });
      }
    })().finally(() => {
      if (activeRun.current === run) activeRun.current = null;
    });
    activeRun.current = run;
    return run;
  }, [connection.phase, connection.serverUrl, language, t]);

  useEffect(() => {
    generation.current += 1;
    const currentGeneration = generation.current;
    const pending = activeRun.current;
    if (pending) {
      void pending.finally(() => {
        if (currentGeneration === generation.current) void refresh();
      });
    } else {
      void refresh();
    }
  }, [connection.revision, language, refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const value = useMemo(() => ({ state, refresh }), [refresh, state]);
  return (
    <PushNotificationContext.Provider value={value}>{children}</PushNotificationContext.Provider>
  );
}

/** 读取当前设备的推送登记状态。 */
export function usePushNotificationRegistration(): PushNotificationContextValue {
  const value = useContext(PushNotificationContext);
  if (!value) throw new Error('PushNotificationProvider is missing.');
  return value;
}
