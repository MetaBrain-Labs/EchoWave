/**
 * 知识问答结构化输出兼容出口。
 *
 * 保留既有模块路径，将通用模型输出恢复能力转交给 ai-runtime。
 *
 * Responsibilities:
 * - 兼容现有内部导入和构建产物测试路径。
 *
 * Notes:
 * - 新实现应直接依赖 ai-runtime/structuredOutput。
 */
export { extractFinalMessageText, parseJsonObject } from '../../ai-runtime/structuredOutput.ts';
