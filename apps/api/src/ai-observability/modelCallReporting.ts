/**
 * 聊天模型调用报告适配器。
 *
 * 将 LangChain/DeepAgent 的真实模型请求和响应转换为框架无关的诊断事件，保留消息角色与顺序。
 *
 * Responsibilities:
 * - 在每次 DeepAgent 模型调用边界记录实际 system/user/assistant/tool 消息。
 * - 记录可见模型输出、工具调用和可选 reasoning，不改变原模型调用结果。
 *
 * Notes:
 * - 最终脱敏和截断由 executionReporter 统一执行。
 */
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

import type { AiExecutionRecorder } from './executionReporter.ts';

/** 测试报告中保留的聊天消息结构。 */
export type AiReportMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'unknown';
  content: unknown;
  name?: string;
  toolCalls?: unknown;
};

function messageRole(message: BaseMessage): AiReportMessage['role'] {
  switch (message.getType()) {
    case 'system':
      return 'system';
    case 'human':
      return 'user';
    case 'ai':
      return 'assistant';
    case 'tool':
      return 'tool';
    default:
      return 'unknown';
  }
}

/** 将 LangChain 消息转换为可稳定序列化且保留角色顺序的报告消息。 */
export function modelMessageForReport(message: BaseMessage): AiReportMessage {
  const role = messageRole(message);
  const name = typeof message.name === 'string' && message.name ? message.name : undefined;
  return {
    role,
    content: message.content,
    ...(name ? { name } : {}),
    ...(message instanceof AIMessage && message.tool_calls?.length
      ? { toolCalls: message.tool_calls }
      : {}),
  };
}

function modelResponseForReport(response: unknown): unknown {
  if (!(response instanceof AIMessage)) return response;
  return {
    role: 'assistant',
    content: response.content,
    responseMetadata: response.response_metadata,
    ...(response.tool_calls?.length ? { toolCalls: response.tool_calls } : {}),
    ...(response.invalid_tool_calls?.length
      ? { invalidToolCalls: response.invalid_tool_calls }
      : {}),
  };
}

type ModelCallReportingOptions = {
  recorder: AiExecutionRecorder;
  name: string;
  provider: string;
  model: string;
};

/** 创建捕获每一次 DeepAgent 实际模型请求和响应的中间件。 */
export function createModelCallReportingMiddleware(options: ModelCallReportingOptions) {
  let sequence = 0;
  return createMiddleware({
    name: `Report${options.name.replace(/[^A-Za-z0-9]/g, '') || 'ModelCall'}`,
    wrapModelCall: async (request, handler) => {
      sequence += 1;
      const attempt = sequence;
      const startedAt = Date.now();
      const messages = [
        ...(request.systemMessage.content ? [modelMessageForReport(request.systemMessage)] : []),
        ...request.messages.map(modelMessageForReport),
      ];
      try {
        const response = await handler(request);
        options.recorder.recordModelCall({
          name: options.name,
          provider: options.provider,
          model: options.model,
          status: 'completed',
          attempt,
          durationMs: Date.now() - startedAt,
          input: { kind: 'chat', messages },
          output: modelResponseForReport(response),
          inputTokens:
            response instanceof AIMessage ? (response.usage_metadata?.input_tokens ?? null) : null,
          outputTokens:
            response instanceof AIMessage ? (response.usage_metadata?.output_tokens ?? null) : null,
        });
        if (response instanceof AIMessage) {
          options.recorder.recordReasoning(response.additional_kwargs.reasoning_content);
        }
        return response;
      } catch (error) {
        options.recorder.recordModelCall({
          name: options.name,
          provider: options.provider,
          model: options.model,
          status: 'failed',
          attempt,
          durationMs: Date.now() - startedAt,
          inputTokens: null,
          outputTokens: null,
          input: { kind: 'chat', messages },
          output: { error },
        });
        throw error;
      }
    },
  });
}
