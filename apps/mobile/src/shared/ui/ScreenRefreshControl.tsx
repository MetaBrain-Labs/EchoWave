/**
 * 服务端数据页面刷新控件。
 *
 * 为各业务页面提供一致的原生下拉刷新颜色与可访问交互。
 *
 * Responsibilities:
 * - 统一渲染 React Native RefreshControl。
 *
 * Notes:
 * - 请求生命周期由 useScreenRefresh 管理。
 */
import { RefreshControl, type RefreshControlProps } from 'react-native';

import { colors } from '@/shared/theme/tokens';

/** 渲染 EchoWave 统一样式的原生下拉刷新控件。 */
export function ScreenRefreshControl(props: RefreshControlProps) {
  return <RefreshControl colors={[colors.secondary]} {...props} tintColor={colors.secondary} />;
}
