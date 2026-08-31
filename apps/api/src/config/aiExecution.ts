/**
 * AI 执行报告配置。
 *
 * 管理本地诊断报告的显式开关与输出目录，不负责创建报告器或写入文件。
 *
 * Responsibilities:
 * - 校验全部报告开关。
 * - 映射执行报告运行时选项。
 *
 * Notes:
 * - 所有开关必须在 `.env` 中显式给出。
 */
import { z } from 'zod';

import { BooleanStringSchema } from './schema.ts';

export const AiExecutionEnvironmentSchema = z.object({
  AI_EXECUTION_REPORT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_OUTPUT_DIR: z.string().min(1),
  AI_EXECUTION_REPORT_CONTEXT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_OUTPUT_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_REASONING_ENABLED: BooleanStringSchema,
  AI_EXECUTION_REPORT_STT_RAW_RESPONSE_ENABLED: BooleanStringSchema,
});

export type AiExecutionReportConfig = {
  enabled: boolean;
  outputDirectory: string;
  includeContext: boolean;
  includeToolContent: boolean;
  includeOutput: boolean;
  includeReasoning: boolean;
  includeSttRawResponses: boolean;
};

/** 将诊断报告环境变量映射为运行时配置。 */
export function createAiExecutionReportConfig(
  values: z.infer<typeof AiExecutionEnvironmentSchema>,
): AiExecutionReportConfig {
  return {
    enabled: values.AI_EXECUTION_REPORT_ENABLED,
    outputDirectory: values.AI_EXECUTION_REPORT_OUTPUT_DIR,
    includeContext: values.AI_EXECUTION_REPORT_CONTEXT_ENABLED,
    includeToolContent: values.AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED,
    includeOutput: values.AI_EXECUTION_REPORT_OUTPUT_ENABLED,
    includeReasoning: values.AI_EXECUTION_REPORT_REASONING_ENABLED,
    includeSttRawResponses: values.AI_EXECUTION_REPORT_STT_RAW_RESPONSE_ENABLED,
  };
}
