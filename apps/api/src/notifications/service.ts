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

/** 固定租户设备登记服务。 */
export class PushDeviceService {
  constructor(private readonly repository: PushNotificationRepository) {}

  register(rawInput: PushDeviceRegisterRequest) {
    return this.repository.register(PushDeviceRegisterRequestSchema.parse(rawInput));
  }

  async disable(rawInput: unknown): Promise<void> {
    const input = PushDeviceDeleteRequestSchema.parse(rawInput);
    await this.repository.disableByToken(input.token);
  }
}
