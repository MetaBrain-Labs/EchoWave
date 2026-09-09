/**
 * Expo Push Notification outbox Worker。
 *
 * 独立消费数据库投递记录，发送端对网络错误与临时供应商失败进行退避，并检查 ticket
 * receipt；DeviceNotRegistered 会停用对应 Token。
 *
 * Responsibilities:
 * - 发送最小通知数据并持久化 Expo ticket。
 * - 检查 receipt、处理失效设备和可重试错误。
 */
import { Expo } from 'expo-server-sdk';

import type { WorkerWakeupSource } from '../infrastructure/workerWakeup.ts';
import { PushNotificationRepository, type ClaimedNotificationDelivery } from './repository.ts';

const SAFETY_SCAN_MS = 15_000;

function localizedContent(delivery: ClaimedNotificationDelivery): {
  title: string;
  body: string;
} {
  if (delivery.locale === 'zh-CN' || !delivery.templateKey) {
    return { title: delivery.title, body: delivery.body };
  }
  const count = (key: string) => Number(delivery.templateParams[key] ?? 0);
  if (delivery.templateKey === 'COMPLETED') {
    return {
      title: 'Analysis batch completed',
      body: `${count('total')} items: ${count('completed')} completed, ${count('failed')} failed.`,
    };
  }
  if (delivery.templateKey === 'PARTIAL_COMPLETED') {
    return {
      title: 'Analysis batch partially completed',
      body: `${count('total')} items: ${count('completed')} completed, ${count('failed')} failed.`,
    };
  }
  if (delivery.templateKey === 'FAILED') {
    return {
      title: 'Analysis batch has failures',
      body: `${count('total')} items: ${count('completed')} completed, ${count('failed')} failed.`,
    };
  }
  if (delivery.templateKey === 'HARD_BLOCKED') {
    return {
      title: 'Analysis task needs attention',
      body: 'Open EchoWave to review the blocked task and required configuration.',
    };
  }
  return { title: delivery.title, body: delivery.body };
}

type PushWorkerOptions = {
  repository: PushNotificationRepository;
  wakeup?: WorkerWakeupSource;
  accessToken?: string;
  enabled?: boolean;
  expo?: Expo;
};

/** 单执行器发送通知，跨实例互斥由 outbox 的 SKIP LOCKED 与领取租约提供。 */
export class PushNotificationWorker {
  private readonly expo: Expo;
  private active?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private unsubscribeWakeup?: () => void;
  private stopping = false;

  constructor(private readonly options: PushWorkerOptions) {
    this.expo =
      options.expo ??
      new Expo(options.accessToken ? { accessToken: options.accessToken } : undefined);
  }

  async start(): Promise<void> {
    if (this.options.enabled === false) return;
    if (this.timer) return;
    this.stopping = false;
    this.unsubscribeWakeup = this.options.wakeup?.subscribe(
      'push-notifications',
      () => void this.pump(),
    );
    this.timer = setInterval(() => void this.pump(), SAFETY_SCAN_MS);
    this.timer.unref();
    void this.pump();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.unsubscribeWakeup?.();
    this.unsubscribeWakeup = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.active) await Promise.allSettled([this.active]);
  }

  private async pump(): Promise<void> {
    if (this.stopping || this.active) return;
    const execution = this.runOne().finally(() => {
      if (this.active === execution) this.active = undefined;
      if (!this.stopping) void this.pump();
    });
    this.active = execution;
    await execution;
  }

  private async runOne(): Promise<void> {
    let delivery: ClaimedNotificationDelivery | undefined;
    try {
      delivery = await this.options.repository.claim();
      if (!delivery) return;
      if (delivery.ticketId) await this.checkReceipt(delivery);
      else await this.send(delivery);
    } catch (error) {
      if (!delivery) {
        console.error('Failed to claim push notification delivery', {
          error: error instanceof Error ? error.name : 'UnknownError',
        });
        return;
      }
      await this.options.repository.retryOrFail(
        delivery,
        'PUSH_NETWORK_ERROR',
        safeProviderMessage(
          error instanceof Error ? error.message : 'Expo Push Service 请求失败。',
        ),
      );
      console.warn('[push-notifications] delivery request failed', {
        deliveryId: delivery.id,
        deviceId: delivery.deviceId,
        stage: delivery.ticketId ? 'receipt' : 'ticket',
        code: 'PUSH_NETWORK_ERROR',
      });
    }
  }

  private async send(delivery: ClaimedNotificationDelivery): Promise<void> {
    if (!Expo.isExpoPushToken(delivery.token)) {
      await this.options.repository.disableDevice(delivery.deviceId);
      await this.options.repository.markFailed(
        delivery.id,
        'INVALID_PUSH_TOKEN',
        'Expo Push Token 格式无效。',
      );
      console.warn('[push-notifications] delivery rejected', {
        deliveryId: delivery.id,
        deviceId: delivery.deviceId,
        stage: 'validation',
        code: 'INVALID_PUSH_TOKEN',
      });
      return;
    }
    const content = localizedContent(delivery);
    const [ticket] = await this.expo.sendPushNotificationsAsync([
      {
        to: delivery.token,
        title: content.title,
        body: content.body,
        sound: 'default',
        channelId: 'analysis-alerts',
        data: {
          type: delivery.eventType,
          batchId: delivery.batchId,
          taskId: delivery.taskId,
        },
      },
    ]);
    if (!ticket) throw new Error('Expo Push Service 未返回 ticket。');
    if (ticket.status === 'ok') {
      await this.options.repository.markTicketed(delivery.id, ticket.id);
      console.info('[push-notifications] delivery ticketed', {
        deliveryId: delivery.id,
        deviceId: delivery.deviceId,
        ticketId: ticket.id,
      });
      return;
    }
    await this.handleExpoError(delivery, ticket.details?.error, ticket.message);
  }

  private async checkReceipt(delivery: ClaimedNotificationDelivery): Promise<void> {
    const receipts = await this.expo.getPushNotificationReceiptsAsync([delivery.ticketId!]);
    const receipt = receipts[delivery.ticketId!];
    if (!receipt) {
      await this.options.repository.retryOrFail(
        delivery,
        'RECEIPT_NOT_READY',
        'Expo receipt 尚未生成。',
      );
      return;
    }
    if (receipt.status === 'ok') {
      await this.options.repository.markDelivered(delivery.id);
      console.info('[push-notifications] delivery receipt confirmed', {
        deliveryId: delivery.id,
        deviceId: delivery.deviceId,
        ticketId: delivery.ticketId,
      });
      return;
    }
    await this.handleExpoError(delivery, receipt.details?.error, receipt.message);
  }

  private async handleExpoError(
    delivery: ClaimedNotificationDelivery,
    code: string | undefined,
    message: string,
  ): Promise<void> {
    const safeMessage = safeProviderMessage(message);
    if (code === 'DeviceNotRegistered') {
      await this.options.repository.disableDevice(delivery.deviceId);
      await this.options.repository.markFailed(delivery.id, code, safeMessage);
      this.logExpoFailure(delivery, code, 'receipt');
      return;
    }
    if (code === 'MessageRateExceeded' || code === 'ProviderError' || code === 'ExpoError') {
      await this.options.repository.retryOrFail(delivery, code, safeMessage, true);
      this.logExpoFailure(delivery, code, delivery.ticketId ? 'receipt' : 'ticket');
      return;
    }
    const finalCode = code ?? 'PUSH_REJECTED';
    await this.options.repository.markFailed(delivery.id, finalCode, safeMessage);
    this.logExpoFailure(delivery, finalCode, delivery.ticketId ? 'receipt' : 'ticket');
  }

  private logExpoFailure(
    delivery: ClaimedNotificationDelivery,
    code: string,
    stage: 'ticket' | 'receipt',
  ): void {
    console.warn('[push-notifications] Expo delivery failed', {
      deliveryId: delivery.id,
      deviceId: delivery.deviceId,
      stage,
      code,
    });
  }
}

/** Provider 错误可能回显 Token；持久化和日志前必须统一脱敏。 */
function safeProviderMessage(message: string): string {
  return message
    .replace(/(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]/g, '[REDACTED_PUSH_TOKEN]')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[REDACTED]')
    .slice(0, 500);
}
