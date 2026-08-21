/**
 * 移动端 API 地址配置。
 *
 * 集中读取并规范化 Expo 公共 API 地址，避免 feature 之间通过传输适配器共享配置。
 *
 * Responsibilities:
 * - 移除配置末尾的斜杠。
 * - 为未配置的本地开发环境提供既有地址。
 *
 * Notes:
 * - `EXPO_PUBLIC_*` 会进入客户端 bundle，不得包含秘密。
 */

/** 当前移动端请求使用的 EchoWave API 根地址。 */
export const apiUrl =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ??
  'http://localhost:3001';
