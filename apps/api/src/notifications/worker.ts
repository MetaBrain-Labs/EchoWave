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

type PushWorkerOptions = {
  repository: PushNotificationRepository;
  wakeup?: WorkerWakeupSource;
  accessToken?: string;
};

/** 单执行器发送通知，跨实例互斥由 outbox 的 SKIP LOCKED 与领取租约提供。 */
export class PushNotificationWorker {
  private readonly expo: Expo;
  private active?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private unsubscribeWakeup?: () => void;
  private stopping = false;

  constructor(private readonly options: PushWorkerOptions) {
    this.expo = new Expo(options.accessToken ? { accessToken: options.accessToken } : undefined);
  }

  async start(): Promise<void> {
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
        error instanceof Error ? error.message : 'Expo Push Service 请求失败。',
      );
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
      return;
    }
    const [ticket] = await this.expo.sendPushNotificationsAsync([
      {
        to: delivery.token,
        title: delivery.title,
        body: delivery.body,
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
      return;
    }
    await this.handleExpoError(delivery, receipt.details?.error, receipt.message);
  }

  private async handleExpoError(
    delivery: ClaimedNotificationDelivery,
    code: string | undefined,
    message: string,
  ): Promise<void> {
    if (code === 'DeviceNotRegistered') {
      await this.options.repository.disableDevice(delivery.deviceId);
      await this.options.repository.markFailed(delivery.id, code, message);
      return;
    }
    if (code === 'MessageRateExceeded' || code === 'ProviderError' || code === 'ExpoError') {
      await this.options.repository.retryOrFail(delivery, code, message, true);
      return;
    }
    await this.options.repository.markFailed(delivery.id, code ?? 'PUSH_REJECTED', message);
  }
}
