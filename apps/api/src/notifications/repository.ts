/**
 * Expo 推送设备和投递 outbox PostgreSQL Repository。
 *
 * 固定租户可登记多个设备；通知事实与任务状态在同一数据库事务创建，独立 Worker 只处理
 * 可重试投递和 receipt，不参与业务状态判断。
 *
 * Responsibilities:
 * - 登记、停用推送设备并领取待发送或待查 receipt 的投递。
 * - 保存 Expo ticket、退避时间和失效设备状态。
 */
import { PushDeviceSchema, type PushDeviceRegisterRequest } from '@echowave/contracts';

import { quoteIdentifier, type DatabasePool } from '../infrastructure/postgres.ts';

export type ClaimedNotificationDelivery = {
  id: string;
  deviceId: string;
  token: string;
  attemptCount: number;
  ticketId: string | null;
  title: string;
  body: string;
  eventType: string;
  batchId: string;
  taskId: string | null;
  locale: 'zh-CN' | 'en';
  templateKey: string | null;
  templateParams: Record<string, unknown>;
};

/** 管理固定租户下的设备和逐设备投递。 */
export class PushNotificationRepository {
  private readonly schema: string;

  constructor(
    private readonly pool: DatabasePool,
    schema: string,
    private readonly tenantId: string,
  ) {
    this.schema = quoteIdentifier(schema);
  }

  private table(name: string): string {
    return `${this.schema}.${quoteIdentifier(name)}`;
  }

  /** 幂等登记设备，并在 App 再次启动时恢复被停用的有效 Token。 */
  async register(input: PushDeviceRegisterRequest) {
    const result = await this.pool.query(
      `INSERT INTO ${this.table('push_devices')}
         (tenant_id, expo_push_token, platform, locale)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, expo_push_token) DO UPDATE
       SET platform = excluded.platform, locale = excluded.locale, enabled = true,
           last_seen_at = now(), updated_at = now()
       RETURNING id, platform, locale, enabled, updated_at`,
      [this.tenantId, input.token, input.platform, input.locale],
    );
    const row = result.rows[0];
    return PushDeviceSchema.parse({
      id: row.id,
      platform: row.platform,
      locale: row.locale,
      enabled: row.enabled,
      updatedAt: new Date(row.updated_at).toISOString(),
    });
  }

  /** 用户关闭推送时按 Token 停用当前设备。 */
  async disableByToken(token: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('push_devices')}
       SET enabled = false, updated_at = now()
       WHERE tenant_id = $1 AND expo_push_token = $2`,
      [this.tenantId, token],
    );
  }

  /** 使用 SKIP LOCKED 领取一条发送或 receipt 查询工作，并设置短租约避免重复领取。 */
  async claim(): Promise<ClaimedNotificationDelivery | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT delivery.id
         FROM ${this.table('notification_deliveries')} delivery
         JOIN ${this.table('push_devices')} device
           ON device.tenant_id = delivery.tenant_id AND device.id = delivery.device_id
         WHERE delivery.tenant_id = $1 AND device.enabled = true
           AND delivery.status IN ('pending', 'retry', 'ticketed')
           AND delivery.next_attempt_at <= now()
         ORDER BY delivery.next_attempt_at, delivery.created_at
         FOR UPDATE OF delivery SKIP LOCKED LIMIT 1
       )
       UPDATE ${this.table('notification_deliveries')} delivery
       SET attempt_count = attempt_count + 1,
           next_attempt_at = now() + interval '5 minutes', updated_at = now()
       FROM candidate, ${this.table('notification_events')} event,
            ${this.table('push_devices')} device
       WHERE delivery.tenant_id = $1 AND delivery.id = candidate.id
         AND event.tenant_id = delivery.tenant_id AND event.id = delivery.event_id
         AND device.tenant_id = delivery.tenant_id AND device.id = delivery.device_id
       RETURNING delivery.id, delivery.device_id, delivery.attempt_count,
                 delivery.expo_ticket_id, device.expo_push_token,
                 device.locale, event.title, event.body, event.event_type, event.batch_id,
                 event.task_id, event.template_key, event.template_params`,
      [this.tenantId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      deviceId: row.device_id,
      token: row.expo_push_token,
      attemptCount: Number(row.attempt_count),
      ticketId: row.expo_ticket_id ?? null,
      title: row.title,
      body: row.body,
      eventType: row.event_type,
      batchId: row.batch_id,
      taskId: row.task_id ?? null,
      locale: row.locale ?? 'zh-CN',
      templateKey: row.template_key ?? null,
      templateParams:
        row.template_params && typeof row.template_params === 'object' ? row.template_params : {},
    };
  }

  async markTicketed(id: string, ticketId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('notification_deliveries')}
       SET status = 'ticketed', expo_ticket_id = $3,
           receipt_due_at = now() + interval '15 minutes',
           next_attempt_at = now() + interval '15 minutes', updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, id, ticketId],
    );
  }

  async markDelivered(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('notification_deliveries')}
       SET status = 'delivered', updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, id],
    );
  }

  /** 网络、429 和 5xx 使用指数退避；超过预算后保留明确失败记录。 */
  async retryOrFail(
    delivery: ClaimedNotificationDelivery,
    code: string,
    message: string,
    resetTicket = false,
  ): Promise<void> {
    const failed = delivery.attemptCount >= 8;
    const delaySeconds = Math.min(15 * 2 ** Math.max(delivery.attemptCount - 1, 0), 3_600);
    await this.pool.query(
      `UPDATE ${this.table('notification_deliveries')}
       SET status = $3, next_attempt_at = now() + make_interval(secs => $4),
           expo_ticket_id = CASE WHEN $7::boolean THEN NULL ELSE expo_ticket_id END,
           receipt_due_at = CASE WHEN $7::boolean THEN NULL ELSE receipt_due_at END,
           last_error_code = $5, last_error_message = $6, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [
        this.tenantId,
        delivery.id,
        failed ? 'failed' : 'retry',
        delaySeconds,
        code,
        message.slice(0, 500),
        resetTicket,
      ],
    );
  }

  async markFailed(id: string, code: string, message: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('notification_deliveries')}
       SET status = 'failed', last_error_code = $3,
           last_error_message = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, id, code, message.slice(0, 500)],
    );
  }

  async disableDevice(deviceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('push_devices')}
       SET enabled = false, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, deviceId],
    );
  }
}
