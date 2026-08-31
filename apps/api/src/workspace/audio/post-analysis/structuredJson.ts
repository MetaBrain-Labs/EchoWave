/**
 * 后置分析结构化输出兼容出口。
 *
 * 保留既有模块路径，将 JSON 与 Chat Completion 文本恢复转交给 ai-runtime。
 *
 * Responsibilities:
 * - 兼容角色与情绪分析现有导入。
 *
 * Notes:
 * - 业务 Schema 校验仍由各分析器负责。
 */
export { chatCompletionText, parseStructuredJson } from '../../../ai-runtime/structuredOutput.ts';
