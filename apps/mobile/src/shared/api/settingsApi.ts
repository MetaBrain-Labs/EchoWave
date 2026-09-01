/**
 * AI 配置中心客户端。
 *
 * 使用共享契约校验传输安全、配置概览与所有修改响应；管理员口令只由调用方在内存传入。
 *
 * Responsibilities:
 * - 为配置中心请求附加短生命周期 Bearer 口令。
 * - 不缓存、记录或持久化 Credential 与管理员口令。
 *
 * Notes:
 * - Secret 是否允许提交最终由服务端真实连接信息决定。
 */
import {
  AdminSessionResponseSchema,
  CapabilityBindingSchema,
  ProviderConnectionSchema,
  SettingsOverviewSchema,
  TransportSecuritySchema,
  type AiCapability,
  type CapabilityBindingWrite,
  type ProviderConnectionWrite,
} from '@echowave/contracts';

import { request } from './request';

function authorized(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export const settingsApi = {
  transport: () => request('/api/settings/transport-security', TransportSecuritySchema),
  verify: (token: string) =>
    request('/api/settings/admin-session', AdminSessionResponseSchema, {
      method: 'POST',
      headers: authorized(token),
    }),
  overview: (token: string) =>
    request('/api/settings', SettingsOverviewSchema, { headers: authorized(token) }),
  createProvider: (token: string, input: ProviderConnectionWrite) =>
    request('/api/settings/providers', ProviderConnectionSchema, {
      method: 'POST',
      body: input,
      headers: authorized(token),
    }),
  updateProvider: (token: string, providerId: string, input: ProviderConnectionWrite) =>
    request(`/api/settings/providers/${providerId}`, ProviderConnectionSchema, {
      method: 'PUT',
      body: input,
      headers: authorized(token),
    }),
  saveCapability: (token: string, capability: AiCapability, input: CapabilityBindingWrite) =>
    request(`/api/settings/capabilities/${capability}`, CapabilityBindingSchema, {
      method: 'PUT',
      body: input,
      headers: authorized(token),
    }),
  importLegacy: (token: string) =>
    request('/api/settings/import-legacy', SettingsOverviewSchema, {
      method: 'POST',
      headers: authorized(token),
    }),
};
