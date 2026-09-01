/**
 * 资源详情来源参数。
 *
 * 规范化知识库、数据源与分析详情使用的内部来源标记，避免页面直接信任任意路由字符串。
 *
 * Responsibilities:
 * - 定义支持的资源根入口。
 * - 将 Expo Router 单值或数组参数解析为受控来源。
 *
 * Notes:
 * - 来源参数仅用于移动端导航，不属于服务端网络契约。
 */
import { firstRouteParam } from './routeParams';

/** 资源详情支持返回的根入口。 */
export type ResourceOrigin = 'group' | 'knowledge-list' | 'source-list';

/** 将不可信路由参数收敛为受支持的资源来源。 */
export function parseResourceOrigin(
  value: string | string[] | undefined,
): ResourceOrigin | undefined {
  const origin = firstRouteParam(value);
  return origin === 'group' || origin === 'knowledge-list' || origin === 'source-list'
    ? origin
    : undefined;
}
