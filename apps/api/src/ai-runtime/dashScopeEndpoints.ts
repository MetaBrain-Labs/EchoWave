/**
 * 百炼业务空间端点解析。
 *
 * 将新版 Workspace 配置和只读历史 URL 配置统一解析为运行时端点，避免各能力分别维护 URL。
 *
 * Responsibilities:
 * - 为 DashScope 原生接口和 OpenAI 兼容接口提供唯一地址来源。
 * - 在历史 revision 仍被冻结时继续解析旧配置，但不延续独立 rerank 地址。
 *
 * Notes:
 * - EventBridge 回调、OSS 与供应商返回的下载 URL 不属于模型调用端点。
 */
import {
  DashScopeConnectionConfigSchema,
  LegacyDashScopeConnectionConfigSchema,
  dashScopeWorkspaceEndpoints,
  type DashScopeStoredConnectionConfig,
} from '@echowave/contracts';

export type ResolvedDashScopeEndpoints = {
  origin: string;
  nativeBaseUrl: string;
  compatibleBaseUrl: string;
  configurationMode: 'dedicated' | 'legacy';
};

/** 解析当前或历史 DashScope 配置，所有 URL 都会移除末尾斜杠。 */
export function resolveDashScopeEndpoints(
  rawConfig: DashScopeStoredConnectionConfig | unknown,
): ResolvedDashScopeEndpoints {
  const current = DashScopeConnectionConfigSchema.safeParse(rawConfig);
  if (current.success) {
    return {
      ...dashScopeWorkspaceEndpoints(current.data),
      configurationMode: 'dedicated',
    };
  }
  const legacy = LegacyDashScopeConnectionConfigSchema.parse(rawConfig);
  const nativeBaseUrl = legacy.baseUrl.replace(/\/$/, '');
  const compatibleBaseUrl = legacy.compatibleBaseUrl.replace(/\/$/, '');
  return {
    origin: new URL(nativeBaseUrl).origin,
    nativeBaseUrl,
    compatibleBaseUrl,
    configurationMode: 'legacy',
  };
}

/** 判断持久配置是否已采用结构化 Workspace 形状。 */
export function isDedicatedDashScopeConfig(rawConfig: unknown): boolean {
  return DashScopeConnectionConfigSchema.safeParse(rawConfig).success;
}
