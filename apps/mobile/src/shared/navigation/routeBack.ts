/**
 * 来源感知的路由返回辅助。
 *
 * 让页面返回按钮优先复用原生导航栈，并在深链或无历史场景下跳转到安全父页面。
 *
 * Responsibilities:
 * - 保持按钮返回、系统返回和侧滑返回使用同一条应用内历史栈。
 * - 为没有可弹出历史的路由提供显式替代目标。
 *
 * Notes:
 * - 原生侧滑由根 Stack 直接处理，本辅助只协调页面内返回按钮和无历史回退。
 */
import type { Href } from 'expo-router';

type BackRouter = {
  back: () => void;
  canGoBack: () => boolean;
  replace: (href: Href) => void;
};

/** 优先弹出真实父页面；没有应用内历史时替换为来源推导出的安全父页面。 */
export function backOrReplace(router: BackRouter, fallback: Href) {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback);
}
