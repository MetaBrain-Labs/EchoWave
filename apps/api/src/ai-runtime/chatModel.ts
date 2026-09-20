/**
 * 文本聊天模型工厂。
 *
 * 按能力绑定的供应商类型创建聊天模型，并隔离各供应商不同的思考模式参数。
 *
 * Responsibilities:
 * - 为百炼（通义千问）兼容端点与 DeepSeek 生成同构的聊天模型实例。
 * - 保证请求体只包含目标供应商认识的参数。
 *
 * Notes:
 * - 两个供应商都提供 OpenAI 兼容的 Chat Completions 端点，因此复用仓库既有的
 *   `ChatDeepSeek` 客户端并只通过 `configuration.baseURL` 与 `modelKwargs` 表达差异，
 *   避免为同一协议引入第二个客户端依赖。
 * - 供应商差异只在此处表达；上层 Agent 与 Worker 不感知具体供应商参数。
 */
import type { ProviderType } from '@echowave/contracts';
import { ChatDeepSeek } from '@langchain/deepseek';

/** 文本类能力实际使用的聊天模型类型。 */
export type ChatStyleModel = ChatDeepSeek;

export type ChatModelThinking = 'enabled' | 'disabled';

export type ChatModelOptions = {
  providerType: ProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  timeout?: number;
  thinking?: ChatModelThinking;
  /** 额外请求体字段，例如 JSON 输出模式；由调用方保证目标供应商支持。 */
  extraModelKwargs?: Record<string, unknown>;
  fetchImplementation?: typeof fetch;
};

/**
 * 供应商专属的思考模式请求参数。
 *
 * DeepSeek 使用 `thinking: { type }`，百炼兼容模式使用 `enable_thinking`；发送对端不认识的
 * 参数会被拒绝，因此必须按供应商区分。
 */
export function thinkingModelKwargs(
  providerType: ProviderType,
  thinking: ChatModelThinking,
): Record<string, unknown> {
  return providerType === 'deepseek'
    ? { thinking: { type: thinking } }
    : { enable_thinking: thinking === 'enabled' };
}

/** 按绑定供应商创建文本模型实例。 */
export function createChatStyleModel(options: ChatModelOptions): ChatStyleModel {
  const modelKwargs = {
    ...(options.thinking === undefined
      ? {}
      : thinkingModelKwargs(options.providerType, options.thinking)),
    ...(options.extraModelKwargs ?? {}),
  };
  return new ChatDeepSeek({
    apiKey: options.apiKey,
    model: options.model,
    configuration: {
      baseURL: options.baseUrl.replace(/\/$/, ''),
      ...(options.fetchImplementation ? { fetch: options.fetchImplementation } : {}),
    },
    ...(Object.keys(modelKwargs).length > 0 ? { modelKwargs } : {}),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  });
}

/** 把绑定供应商的配置解析为 OpenAI 兼容端点地址。 */
export function chatModelBaseUrl(
  providerType: ProviderType,
  config: Record<string, unknown>,
): string {
  if (providerType === 'deepseek') return String(config.baseUrl ?? '');
  return String(config.compatibleBaseUrl ?? config.baseUrl ?? '');
}

/** 判断供应商类型是否可用于文本类能力（百炼兼容模式或 DeepSeek 官方 API）。 */
export function isTextChatProvider(
  providerType: ProviderType,
): providerType is 'dashscope' | 'deepseek' {
  return providerType === 'dashscope' || providerType === 'deepseek';
}
