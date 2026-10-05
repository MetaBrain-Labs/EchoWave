/**
 * 推送设备应用服务。
 *
 * 在固定租户范围登记或停用 Expo Push Token；权限拒绝时移动端可不调用本服务，任务状态
 * 仍通过 REST/SSE 正常工作。
 *
 * Responsibilities:
 * - 解析设备登记与停用请求。
 * - 保持 HTTP 层不直接依赖持久化实现。
 */
import {
  PushDeviceDeleteRequestSchema,
  PushDeviceRegisterRequestSchema,
  type PushDeviceRegisterRequest,
} from '@echowave/contracts';

import type { PushNotificationRepository } from './repository.ts';
import { childLogger } from '../infrastructure/logger.ts';

const logger = childLogger('push-notifications');

/** 固定租户设备登记服务。 */
export class PushDeviceService {
  constructor(private readonly repository: PushNotificationRepository) {}

  async register(rawInput: PushDeviceRegisterRequest) {
    const input = PushDeviceRegisterRequestSchema.parse(rawInput);
    const device = await this.repository.register(input);
    // 只记录设备标识与平台，绝不记录 Token 本体。
    logger.info({ deviceId: device.id, platform: device.platform }, 'Device registered');
    return device;
  }

  async disable(rawInput: unknown): Promise<void> {
    const input = PushDeviceDeleteRequestSchema.parse(rawInput);
    await this.repository.disableByToken(input.token);
  }
}
