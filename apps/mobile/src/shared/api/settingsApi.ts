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
  ModelCatalogResponseSchema,
  ProviderConnectionSchema,
  SettingsOverviewSchema,
  TransportSecuritySchema,
  type AiCapability,
  type CapabilityBindingWrite,
  type ModelCatalogQuery,
  type ProviderConnectionWrite,
} from '@echowave/contracts';

import { request } from './request';

function authorized(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function catalogQuery(query: ModelCatalogQuery | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.model) params.set('model', query.model);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
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
  /** 读取该能力的候选模型目录；供应商列表接口不可用时由服务端显式标记。 */
  modelCatalog: (token: string, capability: AiCapability, query?: ModelCatalogQuery) =>
    request(
      `/api/settings/model-catalog/${capability}${catalogQuery(query)}`,
      ModelCatalogResponseSchema,
      { headers: authorized(token) },
    ),
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
