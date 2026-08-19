/** Orchestrates safe upload staging and the tenant-scoped knowledge/RAG application services. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DocumentUploadResponseSchema,
  type DocumentFormat,
  type KnowledgeBaseCreateRequest,
  type RagQueryRequest,
} from "@echowave/contracts";

import { KnowledgeQueryAgent } from "./queryAgent.ts";
import { RagRepository } from "./repository.ts";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class UploadValidationError extends Error {
  constructor(
    public readonly code:
      | "DOCUMENT_TOO_LARGE"
      | "INVALID_FILE"
      | "UNSUPPORTED_FORMAT",
    message: string,
  ) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export type KnowledgeService = {
  listKnowledgeBases(): ReturnType<RagRepository["listKnowledgeBases"]>;
  getKnowledgeBase(id: string): ReturnType<RagRepository["getKnowledgeBase"]>;
  createKnowledgeBase(
    input: KnowledgeBaseCreateRequest,
  ): ReturnType<RagRepository["createKnowledgeBase"]>;
  updateKnowledgeBase(
    id: string,
    input: Partial<KnowledgeBaseCreateRequest>,
  ): ReturnType<RagRepository["updateKnowledgeBase"]>;
  deleteKnowledgeBase(
    id: string,
  ): ReturnType<RagRepository["deleteKnowledgeBase"]>;
  listDocuments(
    knowledgeBaseId: string,
  ): ReturnType<RagRepository["listDocuments"]>;
  getDocument(
    knowledgeBaseId: string,
    documentId: string,
  ): ReturnType<RagRepository["getDocument"]>;
  uploadDocument(knowledgeBaseId: string, file: File): Promise<unknown>;
  deleteDocument(
    knowledgeBaseId: string,
    documentId: string,
  ): ReturnType<RagRepository["deleteDocument"]>;
  retryDocument(
    knowledgeBaseId: string,
    documentId: string,
  ): ReturnType<RagRepository["retryDocument"]>;
  listChunks(
    knowledgeBaseId: string,
    documentId: string,
  ): ReturnType<RagRepository["listChunks"]>;
  getChunk(
    knowledgeBaseId: string,
    documentId: string,
    chunkId: string,
  ): ReturnType<RagRepository["getChunk"]>;
  query(
    knowledgeBaseId: string,
    input: RagQueryRequest,
  ): ReturnType<KnowledgeQueryAgent["query"]>;
};

const formats: Record<string, { format: DocumentFormat; mime: string }> = {
  ".md": { format: "markdown", mime: "text/markdown" },
  ".docx": {
    format: "word",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  ".xlsx": {
    format: "spreadsheet",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
};

function inspectFile(file: File, buffer: Buffer): { format: DocumentFormat } {
  if (file.size === 0)
    throw new UploadValidationError("INVALID_FILE", "不能上传空文件。");
  if (file.size > MAX_FILE_BYTES)
    throw new UploadValidationError(
      "DOCUMENT_TOO_LARGE",
      "单个文件不能超过 20 MB。",
    );
  const extension = path.extname(file.name).toLowerCase();
  const supported = formats[extension];
  if (!supported) {
    throw new UploadValidationError(
      "UNSUPPORTED_FORMAT",
      "仅支持 .md、.docx 和 .xlsx 文件。",
    );
  }
  const markdownMime = file.type === "text/plain" && extension === ".md";
  if (file.type !== supported.mime && !markdownMime) {
    throw new UploadValidationError(
      "INVALID_FILE",
      "文件扩展名与 MIME 类型不一致。",
    );
  }
  if (supported.format !== "markdown") {
    const zipSignature =
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
        (buffer[2] === 0x05 && buffer[3] === 0x06));
    if (!zipSignature)
      throw new UploadValidationError("INVALID_FILE", "Office 文件签名无效。");
  }
  return { format: supported.format };
}

export class DefaultKnowledgeService implements KnowledgeService {
  constructor(
    private readonly repository: RagRepository,
    private readonly queryAgent: KnowledgeQueryAgent,
    private readonly uploadTempDirectory: string,
    private readonly embeddingModel: string,
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
    return this.repository.retryDocument(knowledgeBaseId, documentId);
  }
  listChunks(knowledgeBaseId: string, documentId: string) {
    return this.repository.listChunks(knowledgeBaseId, documentId);
  }
  getChunk(knowledgeBaseId: string, documentId: string, chunkId: string) {
    return this.repository.getChunk(knowledgeBaseId, documentId, chunkId);
  }
  query(knowledgeBaseId: string, input: RagQueryRequest) {
    return this.queryAgent.query(
      knowledgeBaseId,
      input.question,
      input.conversationId,
    );
  }

  async uploadDocument(knowledgeBaseId: string, file: File) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { format } = inspectFile(file, buffer);
    const directory = path.resolve(this.uploadTempDirectory);
    await mkdir(directory, { recursive: true });
    const stagedPath = path.join(directory, `${randomUUID()}.upload`);
    await writeFile(stagedPath, buffer, { flag: "wx", mode: 0o600 });
    try {
      const result = await this.repository.createIngestion({
        knowledgeBaseId,
        title: path.basename(file.name),
        format,
        sizeBytes: buffer.byteLength,
        sourceSha256: createHash("sha256").update(buffer).digest("hex"),
        stagedPath,
        parserVersion: "echowave-parser-v1",
        embeddingModel: this.embeddingModel,
      });
      const document = await this.repository.getDocument(
        knowledgeBaseId,
        result.documentId,
      );
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
