/**
 * 知识检索设置应用服务。
 *
 * 组合租户开关与配置中心能力，生成公开状态和一次运行所需的冻结重排配置。
 *
 * Responsibilities:
 * - 关闭时不解析重排能力或 Credential。
 * - 管理员写入后返回服务端权威状态。
 *
 * Notes:
 * - Credential 只进入内部冻结配置，不出现在网络响应或日志。
 */
import {
  KnowledgeRetrievalSettingsSchema,
  KnowledgeRetrievalSettingsUpdateRequestSchema,
  type KnowledgeRetrievalSettings,
  type KnowledgeRetrievalSettingsUpdateRequest,
} from '@echowave/contracts';

import type { SettingsService } from '../../settings/service.ts';
import { SettingsError } from '../../settings/types.ts';
import type { KnowledgeRetrievalSettingsRepository } from './settingsRepository.ts';

export const KNOWLEDGE_RERANK_MODEL = 'qwen3.7-text-rerank' as const;

/** 单次问答或后台任务冻结的重排运行配置。 */
export type FrozenRerankRuntime =
  | { enabled: false; revision: number; bindingRevisionId: null; model: null }
  | {
      enabled: true;
      revision: number;
      bindingRevisionId: string | null;
      model: typeof KNOWLEDGE_RERANK_MODEL;
      apiKey: string;
      baseUrl: string;
    };

/** 管理租户知识检索设置并解析安全运行快照。 */
export class KnowledgeRetrievalSettingsService {
  constructor(
    private readonly repository: KnowledgeRetrievalSettingsRepository,
    private readonly settings: Pick<SettingsService, 'authorize' | 'resolveCapability'>,
  ) {}

  private async configuredRuntime(stored: { rerankEnabled: boolean; revision: number }) {
    if (!stored.rerankEnabled) return undefined;
    try {
      const resolved = await this.settings.resolveCapability('knowledge_rerank');
      const config = resolved.provider.config as { rerankBaseUrl?: string };
      if (
        resolved.provider.type !== 'dashscope' ||
        resolved.model !== KNOWLEDGE_RERANK_MODEL ||
        !('apiKey' in resolved.provider.credential) ||
        !config.rerankBaseUrl
      ) {
        return undefined;
      }
      return {
        bindingRevisionId: resolved.revisionId,
        apiKey: resolved.provider.credential.apiKey,
        baseUrl: config.rerankBaseUrl.replace(/\/$/, ''),
      };
    } catch (error) {
      if (error instanceof SettingsError && error.code === 'CONFIGURATION_REQUIRED') return undefined;
      throw error;
    }
  }

  /** 返回不含 Secret 的公开状态。 */
  async overview(): Promise<KnowledgeRetrievalSettings> {
    const stored = await this.repository.get();
    // 关闭时不解析能力或解密凭证；重新开启后的响应会立即反映真实配置状态。
    const configured = stored.rerankEnabled ? Boolean(await this.configuredRuntime(stored)) : false;
    return KnowledgeRetrievalSettingsSchema.parse({
      rerankEnabled: stored.rerankEnabled,
      rerankerModel: KNOWLEDGE_RERANK_MODEL,
      rerankerConfigured: configured,
      revision: stored.revision,
    });
  }

  /** 在一次用例开始时冻结开关、绑定 revision 和供应商配置。 */
  async freezeRuntime(): Promise<FrozenRerankRuntime> {
    const stored = await this.repository.get();
    if (!stored.rerankEnabled) {
      return { enabled: false, revision: stored.revision, bindingRevisionId: null, model: null };
    }
    const configured = await this.configuredRuntime(stored);
    if (!configured) {
      // 开启但未配置由检索层记为 fallback；此处不让主流程失败。
      return {
        enabled: true,
        revision: stored.revision,
        bindingRevisionId: null,
        model: KNOWLEDGE_RERANK_MODEL,
        apiKey: '',
        baseUrl: '',
      };
    }
    return {
      enabled: true,
      revision: stored.revision,
      model: KNOWLEDGE_RERANK_MODEL,
      ...configured,
    };
  }

  /** 校验管理员口令并以乐观锁更新租户开关。 */
  async update(
    authorization: string | undefined,
    input: KnowledgeRetrievalSettingsUpdateRequest,
  ): Promise<KnowledgeRetrievalSettings> {
    this.settings.authorize(authorization);
    await this.repository.update(KnowledgeRetrievalSettingsUpdateRequestSchema.parse(input));
    return this.overview();
  }
}
