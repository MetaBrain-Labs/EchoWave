/**
 * 知识库应用模块。
 *
 * 负责知识库与文档操作的应用编排，并把可信回答委托给独立的深模块；HTTP 传输、
 * 模型适配和底层 SQL 均不属于本文件职责。
 *
 * Responsibilities:
 * - 暴露知识库、文档和文本块的应用级操作。
 * - 校验并安全暂存上传文件。
 * - 通过窄接口调用可信知识回答模块。
 *
 * Notes:
 * - PostgreSQL 仍是服务器数据的权威来源。
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DocumentUploadResponseSchema,
  CitationSourceResponseSchema,
  type DocumentFormat,
  type KnowledgeBaseCreateRequest,
  type RagQueryRequest,
} from '@echowave/contracts';

import type { KnowledgeAnswerModule } from './answer/knowledgeAnswer.ts';
import type { IngestionRepository } from './persistence/ingestionRepository.ts';
import type { KnowledgeRepository } from './catalog/knowledgeRepository.ts';
import type { ConversationRepository } from './persistence/conversationRepository.ts';
import { KNOWLEDGE_PARSER_VERSION } from './ingestion/documentParser.ts';
import { checkedKnowledgeFilePath, knowledgeStoragePath } from './ingestion/storage.ts';
import { RagRepositoryError } from './persistence/errors.ts';
import type { LiveUpdateBroker } from '../infrastructure/liveUpdateBroker.ts';
import type { SettingsService } from '../settings/service.ts';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 可安全展示给用户的上传文件验证错误。 */
export class UploadValidationError extends Error {
  constructor(
    public readonly code: 'DOCUMENT_TOO_LARGE' | 'INVALID_FILE' | 'UNSUPPORTED_FORMAT',
    message: string,
  ) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

/** Hono transport 使用的知识库应用接口。 */
export type KnowledgeService = {
  listKnowledgeBases(): ReturnType<KnowledgeRepository['listKnowledgeBases']>;
  getKnowledgeBase(id: string): ReturnType<KnowledgeRepository['getKnowledgeBase']>;
  createKnowledgeBase(
    input: KnowledgeBaseCreateRequest,
  ): ReturnType<KnowledgeRepository['createKnowledgeBase']>;
  updateKnowledgeBase(
    id: string,
    input: Partial<KnowledgeBaseCreateRequest>,
  ): ReturnType<KnowledgeRepository['updateKnowledgeBase']>;
  deleteKnowledgeBase(id: string): ReturnType<KnowledgeRepository['deleteKnowledgeBase']>;
  listDocuments(knowledgeBaseId: string): ReturnType<KnowledgeRepository['listDocuments']>;
  getDocument(
    knowledgeBaseId: string,
    documentId: string,
  ): ReturnType<KnowledgeRepository['getDocument']>;
  uploadDocument(knowledgeBaseId: string, file: File): Promise<unknown>;
  renameDocument(
    knowledgeBaseId: string,
    documentId: string,
    input: { title: string; expectedVersion: number },
  ): Promise<unknown>;
  replaceDocument(
    knowledgeBaseId: string,
    documentId: string,
    file: File,
    input: { title?: string; expectedVersion: number },
  ): Promise<unknown>;
  getCitationSource(
    knowledgeBaseId: string,
    documentId: string,
    revisionId: string,
  ): ReturnType<KnowledgeRepository['getCitationSource']>;
  getOriginalSource(
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<{ body: Buffer; filename: string; mimeType: string }>;
  deleteDocument(
    knowledgeBaseId: string,
    documentId: string,
  ): ReturnType<KnowledgeRepository['deleteDocument']>;
  retryDocument(
    knowledgeBaseId: string,
    documentId: string,
    expectedCase?: { id: string; version: number },
  ): ReturnType<IngestionRepository['retryDocument']>;
  listChunks(
    knowledgeBaseId: string,
    documentId: string,
  ): ReturnType<KnowledgeRepository['listChunks']>;
  getChunk(
    knowledgeBaseId: string,
    documentId: string,
    chunkId: string,
  ): ReturnType<KnowledgeRepository['getChunk']>;
  listQueryHistory(knowledgeBaseId: string): ReturnType<ConversationRepository['listRecentRuns']>;
  query(
    knowledgeBaseId: string,
    input: RagQueryRequest,
  ): ReturnType<KnowledgeAnswerModule['answer']>;
};

const formats: Record<string, { format: DocumentFormat; mime: string }> = {
  '.md': { format: 'markdown', mime: 'text/markdown' },
  '.docx': {
    format: 'word',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.xlsx': {
    format: 'spreadsheet',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
};

function inspectFile(file: File, buffer: Buffer): { format: DocumentFormat } {
  if (file.size === 0) throw new UploadValidationError('INVALID_FILE', '不能上传空文件。');
  if (file.size > MAX_FILE_BYTES)
    throw new UploadValidationError('DOCUMENT_TOO_LARGE', '单个文件不能超过 20 MB。');
  const extension = path.extname(file.name).toLowerCase();
  const supported = formats[extension];
  if (!supported) {
    throw new UploadValidationError('UNSUPPORTED_FORMAT', '仅支持 .md、.docx 和 .xlsx 文件。');
  }
  const markdownMime = file.type === 'text/plain' && extension === '.md';
  if (file.type !== supported.mime && !markdownMime) {
    throw new UploadValidationError('INVALID_FILE', '文件扩展名与 MIME 类型不一致。');
  }
  if (supported.format !== 'markdown') {
    const zipSignature =
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      ((buffer[2] === 0x03 && buffer[3] === 0x04) || (buffer[2] === 0x05 && buffer[3] === 0x06));
    if (!zipSignature) throw new UploadValidationError('INVALID_FILE', 'Office 文件签名无效。');
  }
  return { format: supported.format };
}

/** 组合知识库仓储、上传暂存与可信回答接口的默认应用实现。 */
export class DefaultKnowledgeService implements KnowledgeService {
  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly ingestionRepository: IngestionRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly answers: Pick<KnowledgeAnswerModule, 'answer'>,
    private readonly knowledgeStorageDirectory: string,
    private readonly settings: Pick<SettingsService, 'resolveCapability'>,
    private readonly liveUpdates?: LiveUpdateBroker,
    private readonly legacyTempDirectory?: string,
  ) {}

  listKnowledgeBases() {
    return this.repository.listKnowledgeBases();
  }
  getKnowledgeBase(id: string) {
    return this.repository.getKnowledgeBase(id);
  }
  createKnowledgeBase(input: KnowledgeBaseCreateRequest) {
    return this.repository.createKnowledgeBase(input);
  }
  updateKnowledgeBase(id: string, input: Partial<KnowledgeBaseCreateRequest>) {
    return this.repository.updateKnowledgeBase(id, input);
  }
  deleteKnowledgeBase(id: string) {
    return this.repository.deleteKnowledgeBase(id);
  }
  listDocuments(knowledgeBaseId: string) {
    return this.repository.listDocuments(knowledgeBaseId);
  }
  getDocument(knowledgeBaseId: string, documentId: string) {
    return this.repository.getDocument(knowledgeBaseId, documentId);
  }
  async deleteDocument(knowledgeBaseId: string, documentId: string) {
    await this.repository.deleteDocument(knowledgeBaseId, documentId);
    this.liveUpdates?.publish({
      kind: 'knowledge-document',
      knowledgeBaseId,
      documentId,
      terminal: true,
    });
  }
  /** 仅公开来源状态，已删除正文不通过此接口开放。 */
  async getCitationSource(knowledgeBaseId: string, documentId: string, revisionId: string) {
    return CitationSourceResponseSchema.parse(
      await this.repository.getCitationSource(knowledgeBaseId, documentId, revisionId),
    );
  }
  /** 读取活动版本原文件；文件已按保留策略清理时返回稳定冲突提示。 */
  async getOriginalSource(knowledgeBaseId: string, documentId: string) {
    const source = await this.repository.getOriginalSource(knowledgeBaseId, documentId);
    const sourcePath = source.storageKey
      ? knowledgeStoragePath(this.knowledgeStorageDirectory, source.storageKey)
      : source.stagedPath
        ? checkedKnowledgeFilePath(source.stagedPath, [
            this.knowledgeStorageDirectory,
            ...(this.legacyTempDirectory ? [this.legacyTempDirectory] : []),
          ])
        : undefined;
    if (!sourcePath) throw new RagRepositoryError('CONFLICT', '原文件已清理，当前无法下载。');
    const mimeType =
      source.format === 'markdown'
        ? 'text/markdown'
        : source.format === 'word'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const extension =
      source.format === 'markdown' ? '.md' : source.format === 'word' ? '.docx' : '.xlsx';
    const filename = path.extname(source.title)
      ? path.basename(source.title)
      : `${path.basename(source.title)}${extension}`;
    try {
      return { body: await readFile(sourcePath), filename, mimeType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new RagRepositoryError('CONFLICT', '原文件已清理，当前无法下载。');
      }
      throw error;
    }
  }
  retryDocument(
    knowledgeBaseId: string,
    documentId: string,
    expectedCase?: { id: string; version: number },
  ) {
    return this.ingestionRepository.retryDocument(knowledgeBaseId, documentId, expectedCase);
  }
  listChunks(knowledgeBaseId: string, documentId: string) {
    return this.repository.listChunks(knowledgeBaseId, documentId);
  }
  getChunk(knowledgeBaseId: string, documentId: string, chunkId: string) {
    return this.repository.getChunk(knowledgeBaseId, documentId, chunkId);
  }
  listQueryHistory(knowledgeBaseId: string) {
    return this.conversationRepository.listRecentRuns(knowledgeBaseId);
  }
  query(knowledgeBaseId: string, input: RagQueryRequest) {
    return this.answers.answer({ knowledgeBaseId, request: input });
  }

  /** 校验并暂存上传文件，成功创建入库任务后返回服务器权威文档状态。 */
  async uploadDocument(knowledgeBaseId: string, file: File) {
    return this.storeUpload(knowledgeBaseId, file);
  }
  /** 替换输入先固化文件，再通过预期版本提交新 revision。 */
  async replaceDocument(
    knowledgeBaseId: string,
    documentId: string,
    file: File,
    input: { title?: string; expectedVersion: number },
  ) {
    const document = await this.repository.getDocument(knowledgeBaseId, documentId);
    return this.storeUpload(knowledgeBaseId, file, {
      documentId,
      expectedVersion: input.expectedVersion,
      title: input.title ?? document.latestRevision?.title ?? document.title,
    });
  }
  /** 改名复制最新原文件，旧部署无文件时使用已固化 chunk 输入。 */
  async renameDocument(
    knowledgeBaseId: string,
    documentId: string,
    input: { title: string; expectedVersion: number },
  ) {
    const source = await this.ingestionRepository.getRevisionSource(knowledgeBaseId, documentId);
    if (source.version !== input.expectedVersion)
      throw new RagRepositoryError('CONFLICT', '文档版本已变化，请刷新后重试。');
    const directory = path.resolve(this.knowledgeStorageDirectory);
    await mkdir(directory, { recursive: true });
    const storageKey = source.rebuildSnapshot ? undefined : `${randomUUID()}.upload`;
    const stagedPath = storageKey ? knowledgeStoragePath(directory, storageKey) : '';
    const rebuildSnapshot = source.rebuildSnapshot
      ? {
          ...source.rebuildSnapshot,
          chunks: source.rebuildSnapshot.chunks.map((chunk) => ({
            ...chunk,
            title: chunk.title === source.revision.title ? input.title : chunk.title,
            embeddingText: [
              `Document: ${input.title}`,
              chunk.headingPath.length ? `Section: ${chunk.headingPath.join(' > ')}` : '',
              chunk.content,
            ]
              .filter(Boolean)
              .join('\n'),
          })),
        }
      : undefined;
    let committed = false;
    try {
      if (storageKey) {
        const sourcePath = source.revision.storage_key
          ? knowledgeStoragePath(directory, source.revision.storage_key)
          : checkedKnowledgeFilePath(source.revision.staged_path, [
              directory,
              ...(this.legacyTempDirectory ? [this.legacyTempDirectory] : []),
            ]);
        await copyFile(sourcePath, stagedPath, constants.COPYFILE_EXCL);
      }
      const embedding = await this.settings.resolveCapability('knowledge_embedding');
      const result = await this.ingestionRepository.createIngestion({
        knowledgeBaseId,
        documentId,
        ...input,
        format: source.revision.format,
        sizeBytes: Number(source.revision.size_bytes),
        sourceSha256: source.revision.source_sha256,
        stagedPath,
        storageKey,
        rebuildSnapshot,
        parserVersion: rebuildSnapshot ? source.revision.parser_version : KNOWLEDGE_PARSER_VERSION,
        embeddingModel: embedding.model,
        embeddingBindingRevisionId: embedding.revisionId,
      });
      committed = true;
      return DocumentUploadResponseSchema.parse({
        document: await this.repository.getDocument(knowledgeBaseId, documentId),
        jobId: result.jobId,
      });
    } catch (error) {
      if (!committed && stagedPath) await unlink(stagedPath).catch(() => undefined);
      throw error;
    }
  }
  /** 原文件先独立持久写入，只有 revision 提交失败才回收本次新文件。 */
  private async storeUpload(
    knowledgeBaseId: string,
    file: File,
    replacement?: { documentId: string; expectedVersion: number; title: string },
  ) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { format } = inspectFile(file, buffer);
    const directory = path.resolve(this.knowledgeStorageDirectory);
    await mkdir(directory, { recursive: true });
    const storageKey = `${randomUUID()}.upload`;
    const stagedPath = knowledgeStoragePath(directory, storageKey);
    await writeFile(stagedPath, buffer, { flag: 'wx', mode: 0o600 });
    let committed = false;
    try {
      const embedding = await this.settings.resolveCapability('knowledge_embedding');
      const result = await this.ingestionRepository.createIngestion({
        knowledgeBaseId,
        title: replacement?.title ?? path.basename(file.name),
        documentId: replacement?.documentId,
        expectedVersion: replacement?.expectedVersion,
        storageKey,
        format,
        sizeBytes: buffer.byteLength,
        sourceSha256: createHash('sha256').update(buffer).digest('hex'),
        stagedPath,
        parserVersion: KNOWLEDGE_PARSER_VERSION,
        embeddingModel: embedding.model,
        embeddingBindingRevisionId: embedding.revisionId,
      });
      committed = true;
      const document = await this.repository.getDocument(knowledgeBaseId, result.documentId);
      return DocumentUploadResponseSchema.parse({
        document,
        jobId: result.jobId,
      });
    } catch (error) {
      if (!committed) await unlink(stagedPath).catch(() => undefined);
      throw error;
    }
  }
}
