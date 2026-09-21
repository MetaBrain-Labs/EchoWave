/**
 * 知识原文件版本存储回归。
 *
 * 验证改名复制独立文件、事务失败回收新文件，以及提交后读取失败仍保留原文件。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { DefaultKnowledgeService } from '../../dist/knowledge/service.js';

function readyDocument(knowledgeBaseId, documentId, version = 2) {
  return {
    id: documentId,
    knowledgeBaseId,
    title: 'v1.md',
    format: 'markdown',
    sizeBytes: 32,
    status: { kind: 'ready', parsedAt: new Date().toISOString() },
    vectorCount: 1,
    parserVersion: 'echowave-parser-v3',
    needsReindex: false,
    version,
    updatedAt: new Date().toISOString(),
  };
}

it('isolates renamed originals and only removes files before a failed commit', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'echowave-knowledge-storage-test-'));
  const knowledgeBaseId = randomUUID();
  const documentId = randomUUID();
  const originalKey = `${randomUUID()}.upload`;
  const originalPath = path.join(directory, originalKey);
  try {
    await writeFile(originalPath, '# 正文\n不可变内容');
    let created;
    let rejectCommit = true;
    let rejectRead = false;
    const repository = {
      getDocument: async () => {
        if (rejectRead) throw new Error('read failed after commit');
        return readyDocument(knowledgeBaseId, documentId);
      },
    };
    const ingestion = {
      getRevisionSource: async () => ({
        version: 1,
        revision: {
          title: 'v1.md',
          format: 'markdown',
          size_bytes: 32,
          source_sha256: 'a'.repeat(64),
          parser_version: 'test',
          storage_key: originalKey,
          staged_path: originalPath,
        },
        rebuildSnapshot: null,
      }),
      createIngestion: async (input) => {
        created = input;
        assert.equal(await readFile(input.stagedPath, 'utf8'), '# 正文\n不可变内容');
        if (rejectCommit) throw new Error('commit failed');
        return { documentId, jobId: randomUUID() };
      },
    };
    const service = new DefaultKnowledgeService(repository, ingestion, {}, {}, directory, {
      resolveCapability: async () => ({ model: 'test-model', revisionId: null }),
    });
    const rename = () =>
      service.renameDocument(knowledgeBaseId, documentId, {
        title: 'v2.md',
        expectedVersion: 1,
      });
    await assert.rejects(rename, /commit failed/);
    assert.deepEqual(await readdir(directory), [originalKey]);
    rejectCommit = false;
    await rename();
    assert.notEqual(created.storageKey, originalKey);
    assert.equal(created.title, 'v2.md');
    assert.equal(created.expectedVersion, 1);
    assert.equal(created.parserVersion, 'echowave-parser-v3');
    const committedKey = created.storageKey;
    assert.equal((await readdir(directory)).length, 2);
    rejectRead = true;
    await assert.rejects(rename, /read failed after commit/);
    assert.equal((await readdir(directory)).length, 3);
    assert.equal(await readFile(path.join(directory, committedKey), 'utf8'), '# 正文\n不可变内容');
    assert.equal(await readFile(originalPath, 'utf8'), '# 正文\n不可变内容');
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});

it('reindexes from the active original with an optimistic version and inherited classification', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'echowave-reindex-storage-test-'));
  const knowledgeBaseId = randomUUID();
  const documentId = randomUUID();
  const revisionId = randomUUID();
  const originalKey = `${randomUUID()}.upload`;
  const originalPath = path.join(directory, originalKey);
  try {
    await writeFile(originalPath, '# 正文\n持久原文件');
    let created;
    const repository = {
      getDocument: async () => readyDocument(knowledgeBaseId, documentId, 3),
      getOriginalSource: async () => ({
        revisionId,
        title: 'v1.md',
        format: 'markdown',
        sizeBytes: 24,
        sourceSha256: 'b'.repeat(64),
        storageKey: originalKey,
        stagedPath: null,
      }),
    };
    const jobId = randomUUID();
    const ingestion = {
      createIngestion: async (input) => {
        created = input;
        assert.equal(await readFile(input.stagedPath, 'utf8'), '# 正文\n持久原文件');
        return { documentId, jobId };
      },
    };
    const service = new DefaultKnowledgeService(repository, ingestion, {}, {}, directory, {
      resolveCapability: async () => ({ model: 'embedding-v1', revisionId: randomUUID() }),
    });

    const result = await service.reindexDocument(knowledgeBaseId, documentId, {
      expectedVersion: 3,
    });

    assert.equal(result.jobId, jobId);
    assert.equal(created.classificationSourceRevisionId, revisionId);
    assert.equal(created.expectedVersion, 3);
    assert.equal(created.parserVersion, 'echowave-parser-v3');
    assert.equal(created.embeddingModel, 'embedding-v1');
    assert.notEqual(created.storageKey, originalKey);
    assert.equal((await readdir(directory)).length, 2);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects reindex when the persisted original is gone and does not enqueue work', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'echowave-reindex-missing-test-'));
  const knowledgeBaseId = randomUUID();
  const documentId = randomUUID();
  let createCalls = 0;
  try {
    const service = new DefaultKnowledgeService(
      {
        getDocument: async () => readyDocument(knowledgeBaseId, documentId, 4),
        getOriginalSource: async () => ({
          revisionId: randomUUID(),
          title: 'v1.md',
          format: 'markdown',
          sizeBytes: 24,
          sourceSha256: 'c'.repeat(64),
          storageKey: `${randomUUID()}.upload`,
          stagedPath: null,
        }),
      },
      {
        createIngestion: async () => {
          createCalls += 1;
        },
      },
      {},
      {},
      directory,
      { resolveCapability: async () => ({ model: 'embedding-v1', revisionId: null }) },
    );

    await assert.rejects(
      service.reindexDocument(knowledgeBaseId, documentId, { expectedVersion: 4 }),
      /原文件已不可用，请替换上传文件/,
    );
    assert.equal(createCalls, 0);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});
