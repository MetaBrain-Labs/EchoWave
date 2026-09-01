/**
 * 租户 AI 配置管理路由。
 *
 * 提供传输安全状态、管理口令验证、供应商连接、能力绑定和 legacy 导入端点。
 *
 * Responsibilities:
 * - 在解析 DTO 前阻止不安全传输中的任何嵌套 Secret。
 * - 为全部配置读写执行管理口令校验和共享契约解析。
 *
 * Notes:
 * - 真实连接安全状态由 Node socket 和可信代理配置决定。
 */
import {
  AdminSessionResponseSchema,
  AiCapabilitySchema,
  CapabilityBindingWriteSchema,
  ProviderConnectionWriteSchema,
  TransportSecuritySchema,
} from '@echowave/contracts';
import type { Hono } from 'hono';

import type { SettingsService } from '../../settings/service.ts';
import { transportSecurityFromContext } from '../../settings/transportSecurity.ts';
import { SettingsError } from '../../settings/types.ts';
import { entityId } from '../response.ts';

const SECRET_KEYS = new Set([
  'apiKey',
  'eventBridgeCallbackToken',
  'accessKeyId',
  'accessKeySecret',
  'credential',
]);

function containsSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecret);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) => SECRET_KEYS.has(key) || containsSecret(child),
  );
}

/** 注册配置中心路由并强制执行服务端传输安全判定。 */
export function registerSettingsRoutes(
  app: Hono,
  service: SettingsService,
  trustedProxyCidrs: string[],
): void {
  app.get('/api/settings/transport-security', (context) =>
    context.json(
      TransportSecuritySchema.parse(transportSecurityFromContext(context, trustedProxyCidrs)),
    ),
  );

  app.post('/api/settings/admin-session', (context) => {
    service.authorize(context.req.header('authorization'));
    return context.json(AdminSessionResponseSchema.parse({ ok: true }));
  });

  app.get('/api/settings', async (context) => {
    service.authorize(context.req.header('authorization'));
    return context.json(
      await service.overview(transportSecurityFromContext(context, trustedProxyCidrs)),
    );
  });

  app.post('/api/settings/providers', async (context) => {
    service.authorize(context.req.header('authorization'));
    const transport = transportSecurityFromContext(context, trustedProxyCidrs);
    const body: unknown = await context.req.json();
    if (!transport.secretSubmissionAllowed && containsSecret(body)) {
      throw new SettingsError(
        'INSECURE_CREDENTIAL_TRANSPORT',
        '当前连接不是 HTTPS，不能通过网络提交 Credential。',
      );
    }
    const input = ProviderConnectionWriteSchema.parse(body);
    return context.json(await service.createProvider(input, transport), 201);
  });

  app.put('/api/settings/providers/:providerId', async (context) => {
    service.authorize(context.req.header('authorization'));
    const transport = transportSecurityFromContext(context, trustedProxyCidrs);
    const body: unknown = await context.req.json();
    if (!transport.secretSubmissionAllowed && containsSecret(body)) {
      throw new SettingsError(
        'INSECURE_CREDENTIAL_TRANSPORT',
        '当前连接不是 HTTPS，不能通过网络提交 Credential。',
      );
    }
    const input = ProviderConnectionWriteSchema.parse(body);
    return context.json(
      await service.updateProvider(entityId(context.req.param('providerId')), input, transport),
    );
  });

  app.put('/api/settings/capabilities/:capability', async (context) => {
    service.authorize(context.req.header('authorization'));
    const capability = AiCapabilitySchema.parse(context.req.param('capability'));
    const input = CapabilityBindingWriteSchema.parse(await context.req.json());
    return context.json(await service.saveBinding(capability, input));
  });

  app.post('/api/settings/import-legacy', async (context) => {
    service.authorize(context.req.header('authorization'));
    await service.importLegacyConfiguration();
    return context.json(
      await service.overview(transportSecurityFromContext(context, trustedProxyCidrs)),
    );
  });
}
