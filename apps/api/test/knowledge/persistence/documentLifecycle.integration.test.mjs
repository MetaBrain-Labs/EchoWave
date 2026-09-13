/**
 * 知识版本真实数据库回归。
 *
 * 在随机隔离 schema 中验证迁移、并发租约、检索、历史引用及可恢复文件清理。
 *
 * Responsibilities:
 * - 验证旧版持续可用及最新版本发布边界。
 * - 验证删除后即刻隔离与历史引文保留。
 *
 * Notes:
 * - 显式 ECHOWAVE_LIVE_KNOWLEDGE_TEST=1 才运行；连接只读取 API .env。
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { readApiConfigFile } from '../../../dist/config/env.js';
import { createDatabasePool, quoteIdentifier } from '../../../dist/infrastructure/postgres.js';
import { IngestionRepository } from '../../../dist/knowledge/persistence/ingestionRepository.js';
import { KnowledgeRepository } from '../../../dist/knowledge/catalog/knowledgeRepository.js';
import { KnowledgeCleanupRepository } from '../../../dist/knowledge/persistence/cleanupRepository.js';
import { KnowledgeCleanupWorker } from '../../../dist/knowledge/ingestion/cleanupWorker.js';
import { PostgresKnowledgeSearch } from '../../../dist/knowledge/retrieval/postgresKnowledgeSearch.js';
import { ConversationRepository } from '../../../dist/knowledge/persistence/conversationRepository.js';
import { BusinessAnalysisRepository } from '../../../dist/workspace/audio/business-analysis/repository.js';

it(
  'preserves RAG consistency across concurrent revisions, lease recovery, deletion and cleanup',
  { skip: process.env.ECHOWAVE_LIVE_KNOWLEDGE_TEST !== '1', timeout: 120_000 },
  async () => {
    const config = readApiConfigFile(new URL('../../../.env', import.meta.url));
    const pool = createDatabasePool(config.database, { registerVectorTypes: false });
    const schema = `echowave_knowledge_test_${randomUUID().replaceAll('-', '')}`;
    const quoted = quoteIdentifier(schema);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'echowave-knowledge-test-'));
    const tenant = randomUUID();
    const otherTenant = randomUUID();
    const kb = randomUUID();
    const otherKb = randomUUID();
    const legacyDoc = randomUUID();
    const legacyRevision = randomUUID();
    const legacyChunk = randomUUID();
    const legacyBusinessJob = randomUUID();
    const vector = Array(1024).fill(0.1);
    let created = false;
    try {
      const extensions = await pool.query("SELECT 1 FROM pg_extension WHERE extname='vector'");
      assert.equal(extensions.rowCount, 1, 'Live tests require the existing pgvector extension');
      await pool.query(`CREATE SCHEMA ${quoted}`);
      created = true;
      const client = await pool.connect();
      try {
        const root = new URL('../../../migrations/', import.meta.url);
        for (const name of (await readdir(root))
          .filter((name) => /^\d{3}_[A-Za-z0-9_]+\.sql$/.test(name))
          .sort()) {
          await client.query('BEGIN');
          await client.query(`SET LOCAL search_path TO ${quoted},public`);
          if (name.startsWith('036_')) {
            await client.query(`INSERT INTO ${quoted}.tenants(id,name) VALUES($1,'legacy')`, [
              tenant,
            ]);
            await client.query(
              `INSERT INTO ${quoted}.knowledge_bases(id,tenant_id,name) VALUES($1,$2,'legacy')`,
              [otherKb, tenant],
            );
            await client.query(
              `INSERT INTO ${quoted}.documents(id,tenant_id,knowledge_base_id,title,format,size_bytes,status)
              VALUES($1,$2,$3,'Legacy','markdown',6,'ready')`,
              [legacyDoc, tenant, otherKb],
            );
            await client.query(
              `INSERT INTO ${quoted}.document_revisions(id,tenant_id,document_id,source_sha256,parser_version,
              embedding_model,embedding_dimensions,status,published_at) VALUES($1,$2,$3,$4,'old','test-model',1024,'ready',now())`,
              [legacyRevision, tenant, legacyDoc, 'b'.repeat(64)],
            );
            await client.query(`UPDATE ${quoted}.documents SET active_revision_id=$2 WHERE id=$1`, [
              legacyDoc,
              legacyRevision,
            ]);
            await client.query(
              `INSERT INTO ${quoted}.document_chunks(id,tenant_id,knowledge_base_id,document_id,revision_id,
              chunk_index,title,content,embedding_text,content_sha256,locator,embedding_model,embedding)
              VALUES($1,$2,$3,$4,$5,1,'Legacy','legacy quote','Document: Legacy','hash',
                '{"kind":"markdown","headingPath":[],"lineStart":1,"lineEnd":1}','test-model',$6::vector)`,
              [legacyChunk, tenant, otherKb, legacyDoc, legacyRevision, JSON.stringify(vector)],
            );
            const conversationId = randomUUID();
            await client.query(
              `INSERT INTO ${quoted}.rag_conversations(id,tenant_id,knowledge_base_id,thread_id,expires_at)
              VALUES($1,$2,$3,$4,now()+interval '1 day')`,
              [conversationId, tenant, otherKb, randomUUID()],
            );
            await client.query(
              `INSERT INTO ${quoted}.rag_runs(tenant_id,knowledge_base_id,conversation_id,question,answer,
              grounded,cited_chunk_ids,embedding_model,chat_model,status)
              VALUES($1,$2,$3,'legacy?','legacy answer',true,$4::jsonb,'test-model','test','completed')`,
              [tenant, otherKb, conversationId, JSON.stringify([legacyChunk])],
            );
          }
          if (name.startsWith('036_')) {
            const group = randomUUID();
            const audio = randomUUID();
            const audioRevision = randomUUID();
            const confirmation = randomUUID();
            const tag = randomUUID();
            await client.query(
              `INSERT INTO ${quoted}.groups(id,tenant_id,name) VALUES($1,$2,'legacy')`,
              [group, tenant],
            );
            await client.query(
              `INSERT INTO ${quoted}.audio_files(id,tenant_id,title,upload_status) VALUES($1,$2,'legacy','ready')`,
              [audio, tenant],
            );
            await client.query(
              `INSERT INTO ${quoted}.audio_analysis_revisions(id,tenant_id,audio_file_id,revision_no,
              transcription_model,analysis_model,status) VALUES($1,$2,$3,1,'test','test','ready')`,
              [audioRevision, tenant, audio],
            );
            await client.query(
              `INSERT INTO ${quoted}.transcript_confirmations(id,tenant_id,analysis_revision_id,version_no)
              VALUES($1,$2,$3,1)`,
              [confirmation, tenant, audioRevision],
            );
            await client.query(
              `INSERT INTO ${quoted}.audio_business_analysis_jobs(id,tenant_id,group_id,audio_file_id,
              analysis_revision_id,transcript_confirmation_id,confirmation_version,model,input_fingerprint,
              settings_snapshot,knowledge_base_ids,status,published_at) VALUES($1,$2,$3,$4,$5,$6,1,'test','legacy','{}',$7,'ready',now())`,
              [legacyBusinessJob, tenant, group, audio, audioRevision, confirmation, [otherKb]],
            );
            await client.query(
              `INSERT INTO ${quoted}.business_analysis_tags(id,tenant_id,job_id,tag_index,category,title,summary,confidence)
              VALUES($1,$2,$3,1,'risk','legacy','legacy',80)`,
              [tag, tenant, legacyBusinessJob],
            );
            await client.query(
              `INSERT INTO ${quoted}.business_analysis_citations(tenant_id,job_id,tag_id,chunk_id,
              knowledge_base_id,document_id,document_title,locator)
              SELECT $1,$2,$3,id,knowledge_base_id,document_id,'legacy.md',locator
              FROM ${quoted}.document_chunks WHERE id=$4`,
              [tenant, legacyBusinessJob, tag, legacyChunk],
            );
          }
          await client.query(await readFile(new URL(name, root), 'utf8'));
          await client.query('COMMIT');
        }
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      await pool.query(
        `INSERT INTO ${quoted}.tenants(id,name) VALUES($1,'test'),($2,'other') ON CONFLICT DO NOTHING`,
        [tenant, otherTenant],
      );
      await pool.query(
        `INSERT INTO ${quoted}.knowledge_bases(id,tenant_id,name) VALUES($1,$2,'test'),($3,$2,'other') ON CONFLICT DO NOTHING`,
        [kb, tenant, otherKb],
      );
      const ingestion = new IngestionRepository(pool, schema, tenant);
      const catalog = new KnowledgeRepository(pool, schema, tenant);
      const search = new PostgresKnowledgeSearch(pool, schema, tenant);
      const legacySource = await ingestion.getRevisionSource(otherKb, legacyDoc);
      assert.equal(legacySource.version, 1);
      assert.equal(legacySource.rebuildSnapshot.chunks[0].content, 'legacy quote');
      await catalog.deleteDocument(otherKb, legacyDoc);
      const legacyHistory = await new ConversationRepository(pool, schema, tenant).listRecentRuns(
        otherKb,
      );
      assert.equal(legacyHistory.items[0].citations[0].quoteSnapshot, 'legacy quote');
      const input = async (title, documentId, version) => {
        const key = `${randomUUID()}.upload`;
        const file = path.join(directory, key);
        await writeFile(file, title);
        return {
          knowledgeBaseId: kb,
          documentId,
          expectedVersion: version,
          title,
          format: 'markdown',
          sizeBytes: Buffer.byteLength(title),
          sourceSha256: 'a'.repeat(64),
          stagedPath: file,
          storageKey: key,
          parserVersion: 'test',
          embeddingModel: 'test-model',
          embeddingBindingRevisionId: null,
        };
      };
      const publish = async (job, repository = ingestion) =>
        repository.publishRevision({
          job,
          chunks: [
            {
              index: 1,
              title: job.title,
              headingPath: [],
              content: `Body ${job.title}`,
              embeddingText: `Document: ${job.title}\nBody ${job.title}`,
              contentSha256: job.title.padEnd(64, 'x').slice(0, 64),
              locator: { kind: 'markdown', headingPath: [], lineStart: 1, lineEnd: 1 },
            },
          ],
          vectors: [vector],
          previewText: job.title,
          warnings: [],
          provider: 'test',
          embeddingTokens: 1,
          estimatedCost: { amount: 0, currency: 'USD' },
          embeddingModel: 'test-model',
        });
      const v1 = await ingestion.createIngestion(await input('V1'));
      const job1 = await ingestion.claimIngestionJob();
      await publish(job1);
      assert.equal((await search.search(kb, vector, 'test-model'))[0].documentTitle, 'V1');
      assert.equal((await search.search(otherKb, vector, 'test-model')).length, 0);
      assert.equal(
        (
          await new PostgresKnowledgeSearch(pool, schema, otherTenant).search(
            kb,
            vector,
            'test-model',
          )
        ).length,
        0,
      );
      assert.equal((await search.search(kb, vector, 'other-model')).length, 0);
      const oldHit = (await search.search(kb, vector, 'test-model'))[0];
      const conversations = new ConversationRepository(pool, schema, tenant);
      const conversation = await conversations.getOrCreateConversation(kb);
      const runId = await conversations.beginRun({
        knowledgeBaseId: kb,
        conversationId: conversation.id,
        question: 'test',
        embeddingModel: 'test-model',
        chatModel: 'test',
        chatProvider: 'test',
        embeddingBindingRevisionId: null,
        chatBindingRevisionId: null,
      });
      const citation = {
        number: 1,
        knowledgeBaseId: kb,
        documentId: v1.documentId,
        revisionId: job1.revisionId,
        documentTitle: 'V1',
        chunkId: oldHit.id,
        quoteSnapshot: oldHit.content,
        excerpt: oldHit.content,
        locator: oldHit.locator,
      };
      await conversations.completeRun(runId, {
        answer: 'historical',
        grounded: true,
        citedChunkIds: [oldHit.id],
        citations: [citation],
        embeddingTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 1,
      });
      await ingestion.createIngestion(await input('V2', v1.documentId, 1));
      const job2 = await ingestion.claimIngestionJob();
      assert.equal((await search.search(kb, vector, 'test-model'))[0].documentTitle, 'V1');
      await ingestion.createIngestion(await input('V3', v1.documentId, 2));
      const job3 = await ingestion.claimIngestionJob();
      await publish(job3);
      await assert.rejects(() => publish(job2));
      assert.equal(
        (await search.searchMany([kb, otherKb], vector, 'test-model'))[0].documentTitle,
        'V3',
      );
      await assert.rejects(() => ingestion.setJobStage(job2, 'parse', 'parsing'));
      await ingestion.failJob(job2, 'LATE', 'late', true);
      assert.equal((await catalog.getDocument(kb, v1.documentId)).title, 'V3');
      const staleInput = await input('stale', v1.documentId, 1);
      await assert.rejects(
        () => ingestion.createIngestion(staleInput),
        (error) => error.code === 'CONFLICT',
      );
      await ingestion.createIngestion(await input('V4', v1.documentId, 3));
      const job4 = await ingestion.claimIngestionJob();
      await ingestion.failJob(job4, 'UPSTREAM', 'temporary', true);
      assert.equal((await search.search(kb, vector, 'test-model'))[0].documentTitle, 'V3');
      await ingestion.retryDocument(kb, v1.documentId);
      const originalLease = await ingestion.claimIngestionJob();
      await pool.query(
        `UPDATE ${quoted}.ingestion_jobs SET lease_until=now()-interval '1 second' WHERE id=$1`,
        [originalLease.id],
      );
      const takeover = await ingestion.claimIngestionJob();
      assert.notEqual(takeover.leaseToken, originalLease.leaseToken);
      await assert.rejects(() => publish(originalLease));
      await publish(takeover);
      const business = new BusinessAnalysisRepository(pool, schema, tenant);
      const version = await pool.query(
        `SELECT content_version FROM ${quoted}.knowledge_bases WHERE id=$1`,
        [kb],
      );
      await business.assertKnowledgeCurrent({
        knowledgeBaseIds: [kb],
        knowledgeVersionSnapshot: [{ id: kb, version: version.rows[0].content_version }],
      });
      await assert.rejects(
        () =>
          business.assertKnowledgeCurrent({
            knowledgeBaseIds: [kb],
            knowledgeVersionSnapshot: [{ id: kb, version: 0 }],
          }),
        (error) => error.code === 'KNOWLEDGE_CHANGED',
      );
      await assert.rejects(
        () =>
          business.assertKnowledgeCurrent({
            knowledgeBaseIds: [randomUUID()],
            knowledgeVersionSnapshot: [],
          }),
        (error) => error.code === 'KNOWLEDGE_CHANGED',
      );
      await ingestion.createIngestion(await input('V5', v1.documentId, 4));
      const job5 = await ingestion.claimIngestionJob();
      // 两个独立连接实际竞争知识库行锁，删除提交后迟到发布必须被拒绝。
      const deletionClient = await pool.connect();
      const publicationClient = await pool.connect();
      let unlockDeletion;
      let signalLock;
      const deletionGate = new Promise((resolve) => {
        unlockDeletion = resolve;
      });
      const lockHeld = new Promise((resolve) => {
        signalLock = resolve;
      });
      const deletionPool = {
        connect: async () => ({
          query: async (sql, values) => {
            const result = await deletionClient.query(sql, values);
            if (/knowledge_bases/.test(sql) && /FOR UPDATE/.test(sql)) {
              signalLock();
              await deletionGate;
            }
            return result;
          },
          release: () => {},
        }),
      };
      const publicationPool = {
        connect: async () => ({
          query: (sql, values) => publicationClient.query(sql, values),
          release: () => {},
        }),
      };
      let deletion;
      let publication;
      try {
        const pid = (await publicationClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        deletion = new KnowledgeRepository(deletionPool, schema, tenant).deleteDocument(
          kb,
          v1.documentId,
        );
        await lockHeld;
        publication = publish(job5, new IngestionRepository(publicationPool, schema, tenant)).then(
          () => ({ ok: true }),
          (error) => ({ error }),
        );
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const locks = await pool.query('SELECT cardinality(pg_blocking_pids($1)) AS count', [
            pid,
          ]);
          if (locks.rows[0].count > 0) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(blocked, true, 'Publication must compete on the deletion transaction lock');
        unlockDeletion();
        await deletion;
        assert.ok((await publication).error);
      } finally {
        unlockDeletion();
        await Promise.allSettled([deletion, publication]);
        deletionClient.release();
        publicationClient.release();
      }
      assert.equal((await search.search(kb, vector, 'test-model')).length, 0);
      await assert.rejects(() => publish(takeover));
      assert.equal(
        (await catalog.getCitationSource(kb, v1.documentId, job1.revisionId)).status,
        'deleted',
      );
      assert.equal(
        (await catalog.getCitationSource(kb, v1.documentId, legacyRevision)).status,
        'unavailable',
      );
      const cleanup = new KnowledgeCleanupRepository(pool, schema, tenant);
      let leased = await cleanup.claim();
      while (leased && !leased.storage_key) {
        await cleanup.removeChunks(leased);
        await cleanup.complete(leased);
        leased = await cleanup.claim();
      }
      assert.ok(leased?.storage_key);
      await cleanup.removeChunks(leased);
      await cleanup.fail(leased, 'SIMULATED_UNLINK_FAILURE');
      assert.equal((await search.search(kb, vector, 'test-model')).length, 0);
      await pool.query(`UPDATE ${quoted}.knowledge_cleanup_jobs SET next_attempt_at=now()`);
      const worker = new KnowledgeCleanupWorker(cleanup, directory, directory);
      const originalFile = path.join(directory, leased.storage_key);
      const backupFile = path.join(directory, `${randomUUID()}.backup`);
      await rename(originalFile, backupFile);
      await mkdir(originalFile);
      worker.start();
      // 使用受控目录产生真实 unlink 失败，任务保留 files 阶段而检索继续隔离。
      let failedCleanup;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        failedCleanup = (
          await pool.query(
            `SELECT status,stage,error_code FROM ${quoted}.knowledge_cleanup_jobs WHERE id=$1`,
            [leased.id],
          )
        ).rows[0];
        if (failedCleanup.error_code === 'FILE_CLEANUP_FAILED') break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await worker.stop();
      assert.equal(failedCleanup.status, 'failed');
      assert.equal(failedCleanup.stage, 'files');
      assert.equal(failedCleanup.error_code, 'FILE_CLEANUP_FAILED');
      assert.equal((await search.search(kb, vector, 'test-model')).length, 0);
      await rmdir(originalFile);
      await rename(backupFile, originalFile);
      await pool.query(`UPDATE ${quoted}.knowledge_cleanup_jobs SET next_attempt_at=now()`);
      worker.start();
      // 等待权威清理任务完成，而不是依靠固定时长判断成功。
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const pending = await pool.query(
          `SELECT count(*)::int AS count FROM ${quoted}.knowledge_cleanup_jobs WHERE status<>'completed'`,
        );
        if (!pending.rows[0].count) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await worker.stop();
      assert.equal(await cleanup.claim(), undefined);
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS count FROM ${quoted}.document_chunks`)).rows[0]
          .count,
        0,
      );
      await assert.rejects(() => access(job1.stagedPath));
      const history = await conversations.listRecentRuns(kb);
      assert.equal(history.items[0].answer, 'historical');
      assert.equal(history.items[0].citations[0].quoteSnapshot, oldHit.content);
      assert.equal(history.items[0].citations[0].sourceStatus, 'deleted');
      const businessSnapshot = (
        await pool.query(
          `SELECT quote_snapshot,revision_id,document_title FROM ${quoted}.business_analysis_citations WHERE job_id=$1`,
          [legacyBusinessJob],
        )
      ).rows[0];
      assert.equal(businessSnapshot.quote_snapshot, 'legacy quote');
      assert.equal(businessSnapshot.revision_id, legacyRevision);
      assert.equal(businessSnapshot.document_title, 'legacy.md');
      await catalog.deleteKnowledgeBase(kb);
      assert.equal((await search.searchMany([kb], vector, 'test-model')).length, 0);
      assert.equal((await conversations.listRecentRuns(kb)).items.length, 1);
    } finally {
      if (created) {
        assert.match(schema, /^echowave_knowledge_test_[0-9a-f]{32}$/);
        await pool.query(`DROP SCHEMA ${quoted} CASCADE`);
      }
      await pool.end();
      assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
