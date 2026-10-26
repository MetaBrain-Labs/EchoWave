/**
 * 桌面顶栏当前页面搜索注册。
 *
 * 让拥有既有搜索状态的页面临时共享搜索输入给桌面顶栏。
 *
 * Responsibilities:
 * - 记录当前聚焦页面的搜索值、占位文案和输入回调。
 * - 在页面失焦时清除注册，避免顶栏修改非当前页面的搜索条件。
 *
 * Notes:
 * - 不创建全局搜索或网络行为；搜索状态仍属于注册页面。
 */
import { useFocusEffect } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** 描述当前页面已有的搜索字段。 */
export type TopBarSearchRegistration = {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
};

type TopBarSearchValue = {
  register: (value: TopBarSearchRegistration | null) => void;
  snapshot: { current: TopBarSearchRegistration | null };
  revision: number;
};

/** 桌面壳读取当前聚焦页面搜索状态的上下文。 */
export const TopBarSearchContext = createContext<TopBarSearchValue | null>(null);

/** 注册页面已有搜索状态，并随路由焦点安全释放。 */
export function useTopBarSearchRegistration({
  onChange,
  placeholder,
  value,
}: TopBarSearchRegistration) {
  const context = useContext(TopBarSearchContext);
  const register = context?.register;
  const registration = useRef<TopBarSearchRegistration>({ onChange, placeholder, value });
  const focused = useRef(false);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      register?.(registration.current);
      return () => {
        focused.current = false;
        register?.(null);
      };
    }, [register]),
  );

  useEffect(() => {
    registration.current = { onChange, placeholder, value };
    if (focused.current) register?.(registration.current);
  }, [onChange, placeholder, register, value]);
}

/** 创建轻量搜索注册表，使搜索输入只重绘顶栏，不更新页面子树。 */
export function useTopBarSearchRegistry(): TopBarSearchValue {
  const snapshot = useRef<TopBarSearchRegistration | null>(null);
  const [revision, setRevision] = useState(0);
  const register = useCallback((next: TopBarSearchRegistration | null) => {
    const current = snapshot.current;
    const changed =
      current === null ||
      next === null ||
      current.value !== next.value ||
      current.placeholder !== next.placeholder;
    snapshot.current = next;
    if (changed) setRevision((currentRevision) => currentRevision + 1);
  }, []);
  return useMemo(() => ({ register, revision, snapshot }), [register, revision]);
}

/** 读取当前桌面搜索注册位；桌面 Provider 外的页面安全返回空状态。 */
export function useTopBarSearch(): TopBarSearchValue {
  const context = useContext(TopBarSearchContext);
  const snapshot = useRef<TopBarSearchRegistration | null>(null);
  return useMemo(() => context ?? { register: () => undefined, revision: 0, snapshot }, [context]);
}
