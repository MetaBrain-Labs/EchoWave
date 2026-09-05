/**
 * 音频运行模式应用服务。
 *
 * 组合持久化配置、AI 能力绑定和本地 FFmpeg/VAD 可用性，生成不含 Secret 的模式概览。
 *
 * Responsibilities:
 * - 阻止启用缺少必要能力的模式。
 * - 使用配置中心管理员口令保护租户级变更。
 *
 * Notes:
 * - 当前模式即使运行时能力暂时失效仍可读取，失败原因由概览显式返回。
 */
import {
  AudioRuntimeOverviewSchema,
  AudioRuntimeUpdateRequestSchema,
  type AudioRuntimeMode,
  type AudioRuntimeOverview,
  type AudioRuntimeUpdateRequest,
} from '@echowave/contracts';

import type { SettingsService } from '../../../settings/service.ts';
import { SettingsError } from '../../../settings/types.ts';
import type { AudioInputPreprocessor } from '../transcription/audioPreprocessor.ts';
import type { AudioRuntimeRepository } from './repository.ts';

/** 管理固定租户的音频运行模式与就绪状态。 */
export class AudioRuntimeService {
  constructor(
    private readonly repository: AudioRuntimeRepository,
    private readonly settings: SettingsService,
    private readonly preprocessor: AudioInputPreprocessor,
  ) {}

  private async capabilityAvailable(
    capability: Parameters<SettingsService['resolveCapability']>[0],
  ) {
    try {
      await this.settings.resolveCapability(capability);
      return true;
    } catch (error) {
      if (error instanceof SettingsError && error.code === 'CONFIGURATION_REQUIRED') return false;
      throw error;
    }
  }

  /** 检查指定运行模式是否具备创建新上传批次所需的本地与供应商能力。 */
  async availabilityForMode(mode: AudioRuntimeMode) {
    const local = this.preprocessor.capabilities();
    if (!local.ffmpeg.available || !local.sileroVad.available) {
      return {
        mode,
        available: false,
        unavailableReason: !local.ffmpeg.available
          ? '服务端 FFmpeg 不可用。'
          : (local.sileroVad.unavailableReason ?? 'Silero VAD 不可用。'),
      };
    }
    if (!(await this.capabilityAvailable('audio_transcription'))) {
      return { mode, available: false, unavailableReason: '尚未绑定 DashScope 音频转写能力。' };
    }
    if (mode === 'lightweight_local') {
      if (!(await this.capabilityAvailable('audio_emotion'))) {
        return {
          mode,
          available: false,
          unavailableReason: '尚未绑定默认开启所需的 DashScope 声学情绪能力。',
        };
      }
      return { mode, available: true, unavailableReason: null };
    }
    const storageCapability = mode === 'hybrid' ? 'audio_staging' : 'audio_primary_storage';
    if (!(await this.capabilityAvailable(storageCapability))) {
      return {
        mode,
        available: false,
        unavailableReason:
          mode === 'hybrid' ? '尚未绑定临时 OSS 能力。' : '尚未绑定权威音频对象存储。',
      };
    }
    if (mode === 'object_storage' && !(await this.capabilityAvailable('audio_staging'))) {
      return { mode, available: false, unavailableReason: '尚未绑定 ASR 中间文件存储能力。' };
    }
    return { mode, available: true, unavailableReason: null };
  }

  async overview(): Promise<AudioRuntimeOverview> {
    const stored = await this.repository.get();
    const modes = await Promise.all(
      (['hybrid', 'object_storage', 'lightweight_local'] as const).map((mode) =>
        this.availabilityForMode(mode),
      ),
    );
    return AudioRuntimeOverviewSchema.parse({
      mode: stored.mode,
      revision: stored.revision,
      retention: {
        originalRetentionDays: stored.originalRetentionDays,
        intermediateRetentionHours: stored.intermediateRetentionHours,
      },
      modes,
    });
  }

  async update(
    authorization: string | undefined,
    input: AudioRuntimeUpdateRequest,
  ): Promise<AudioRuntimeOverview> {
    this.settings.authorize(authorization);
    const request = AudioRuntimeUpdateRequestSchema.parse(input);
    const availability = await this.availabilityForMode(request.mode);
    if (!availability.available) {
      throw new SettingsError('CONFIGURATION_REQUIRED', availability.unavailableReason!);
    }
    await this.repository.update(request);
    return this.overview();
  }
}
