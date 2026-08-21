/**
 * Expo Router 参数规范化工具。
 *
 * 将 Expo Router 可能返回的单值或数组参数收敛为页面使用的单个字符串。
 *
 * Responsibilities:
 * - 选择数组参数的第一个值。
 * - 将缺失参数稳定转换为空字符串。
 *
 * Notes:
 * - 业务层仍需按自己的契约判断空字符串是否合法。
 */

/** 返回路由参数的首个字符串值。 */
export function firstRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}
