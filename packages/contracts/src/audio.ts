/**
 * 音频契约兼容出口。
 *
 * 保留包内既有导入路径，按处理生命周期和转写能力重导出领域契约。
 *
 * Responsibilities:
 * - 维持所有既有 Schema、常量和类型名称。
 */
export * from './audio/processing.ts';
export * from './audio/runtime.ts';
export * from './audio/transcription.ts';
