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
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DocumentUploadResponseSchema,
  type DocumentFormat,
  type KnowledgeBaseCreateRequest,
  type RagQueryRequest,
} from '@echowave/contracts';

import type { KnowledgeAnswerModule } from './answer/knowledgeAnswer.ts';
import type { IngestionRepository } from './persistence/ingestionRepository.ts';
import type { KnowledgeRepository } from './catalog/knowledgeRepository.ts';
import type { ConversationRepository } from './persistence/conversationRepository.ts';
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
  deleteDocument(
    knowledgeBaseId: string,
    documentId: string,
  ): ReturnType<KnowledgeRepository['deleteDocument']>;
  retryDocument(
    knowledgeBaseId: string,
    documentId: string,
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
    private readonly uploadTempDirectory: string,
    private readonly settings: Pick<SettingsService, 'resolveCapability'>,
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
  deleteDocument(knowledgeBaseId: string, documentId: string) {
    return this.repository.deleteDocument(knowledgeBaseId, documentId);
  }
  retryDocument(knowledgeBaseId: string, documentId: string) {
    return this.ingestionRepository.retryDocument(knowledgeBaseId, documentId);
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
    const buffer = Buffer.from(await file.arrayBuffer());
    const { format } = inspectFile(file, buffer);
    const directory = path.resolve(this.uploadTempDirectory);
    await mkdir(directory, { recursive: true });
    const stagedPath = path.join(directory, `${randomUUID()}.upload`);
    await writeFile(stagedPath, buffer, { flag: 'wx', mode: 0o600 });
    try {
      const embedding = await this.settings.resolveCapability('knowledge_embedding');
      const result = await this.ingestionRepository.createIngestion({
        knowledgeBaseId,
        title: path.basename(file.name),
        format,
        sizeBytes: buffer.byteLength,
        sourceSha256: createHash('sha256').update(buffer).digest('hex'),
        stagedPath,
        parserVersion: 'echowave-parser-v1',
        embeddingModel: embedding.model,
        embeddingBindingRevisionId: embedding.revisionId,
      });
      const document = await this.repository.getDocument(knowledgeBaseId, result.documentId);
      return DocumentUploadResponseSchema.parse({
        document,
        jobId: result.jobId,
      });
    } catch (error) {
      await unlink(stagedPath).catch(() => undefined);
      throw error;
    }
  }
}
