/**
 * 有界知识类别建议器。
 *
 * 一次模型调用建议文档与工作表类别，失败只生成非阻断状态。
 *
 * Responsibilities:
 * - 对每张工作表公平采样并校验模型类别白名单。
 * - 记录模型耗时与用量，但不自动确认分类。
 *
 * Notes:
 * - 复用 knowledge_chat 绑定，不引入新的配置能力。
 */
import {
  ClassificationSuggestionSchema,
  type KnowledgeCategory,
  type ClassificationSuggestion,
  type SourceLocator,
} from '@echowave/contracts';
import type { AiExecutionRecorder } from '../../ai-observability/executionReporter.ts';
import type { ChatStyleModel } from '../../ai-runtime/chatModel.ts';
import { extractFinalMessageText, parseJsonObject } from '../../ai-runtime/structuredOutput.ts';
import { classificationContext } from './CONTEXT.ts';

/** 分类使用的解析片段，不包含向量。 */
export type ClassificationChunk = { content: string; locator: SourceLocator };
/** 公平采样每个工作表的前、中、末片段，总正文不超过 12000 字符。 */
export function buildClassificationSample(chunks: readonly ClassificationChunk[]) {
  const groups = new Map<string, ClassificationChunk[]>();
  for (const chunk of chunks) {
    const sheet = chunk.locator.kind === 'spreadsheet' ? chunk.locator.sheet : '';
    const rows = groups.get(sheet) ?? [];
    rows.push(chunk);
    groups.set(sheet, rows);
  }
  const budget = Math.floor(12000 / Math.max(1, groups.size));
  return [...groups].map(([sheet, rows]) => ({
    sheet,
    excerpts: [...new Set([0, Math.floor(rows.length / 2), rows.length - 1])]
      .map((index) => rows[index]?.content ?? '')
      .join('\n')
      .slice(0, budget),
  }));
}
/** 校验建议只能引用当前目录和真实工作表。 */
export function validateClassificationSuggestion(
  value: unknown,
  categories: readonly KnowledgeCategory[],
  sheets: readonly string[],
): ClassificationSuggestion {
  const suggestion = ClassificationSuggestionSchema.parse({
    ...(value && typeof value === 'object' ? value : {}),
    status: 'pending',
    message: '',
  });
  const ids = new Set(
    categories.filter((category) => category.active).map((category) => category.id),
  );
  if (
    !suggestion.documentCategoryId ||
    !ids.has(suggestion.documentCategoryId) ||
    suggestion.sheets.some((item) => !ids.has(item.categoryId) || !sheets.includes(item.sheet))
  )
    throw new Error('Invalid classification whitelist');
  return suggestion;
}
/** 基于现有知识问答绑定生成非生效建议。 */
export class KnowledgeClassifier {
  constructor(
    private readonly resolveModel: () => Promise<{
      model: Pick<ChatStyleModel, 'invoke'>;
      name: string;
      provider: string;
    }>,
  ) {}
  /** 模型不可用、超时或输出无效时返回可重试失败状态，不传播文件指令。 */
  async suggest(
    title: string,
    chunks: readonly ClassificationChunk[],
    categories: readonly KnowledgeCategory[],
    report: AiExecutionRecorder,
  ): Promise<ClassificationSuggestion> {
    const samples = buildClassificationSample(chunks);
    const messages = [
      { role: 'system' as const, content: classificationContext() },
      {
        role: 'user' as const,
        content: JSON.stringify({
          title,
          catalogue: categories.filter((item) => item.active),
          samples,
        }),
      },
    ];
    const startedAt = Date.now();
    let modelName = 'knowledge_chat';
    let providerName = 'dashscope';
    try {
      const resolved = await this.resolveModel();
      modelName = resolved.name;
      providerName = resolved.provider;
      const result = await resolved.model.invoke(messages, { signal: AbortSignal.timeout(12000) });
      const value = parseJsonObject(extractFinalMessageText([result]).text);
      const suggestion = validateClassificationSuggestion(
        value,
        categories,
        samples.map((sample) => sample.sheet).filter(Boolean),
      );
      report.recordModelCall({
        name: 'knowledge-classification',
        provider: providerName,
        model: modelName,
        status: 'completed',
        attempt: 1,
        durationMs: Date.now() - startedAt,
        inputTokens: result.usage_metadata?.input_tokens ?? null,
        outputTokens: result.usage_metadata?.output_tokens ?? null,
        input: { kind: 'chat', messages },
        output: suggestion,
      });
      return suggestion;
    } catch {
      report.recordModelCall({
        name: 'knowledge-classification',
        provider: providerName,
        model: modelName,
        status: 'failed',
        attempt: 1,
        durationMs: Date.now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        input: { kind: 'chat', messages },
        output: { error: 'CLASSIFICATION_UNAVAILABLE' },
      });
      return {
        status: 'failed',
        documentCategoryId: null,
        sheets: [],
        message: '类别建议暂时不可用，已保留继承分类，可重试。',
      };
    }
  }
}
