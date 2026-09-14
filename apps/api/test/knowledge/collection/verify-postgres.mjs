/**
 * 案例收集 PostgreSQL 事务回归。
 *
 * 在隔离 schema 中应用编号迁移，以独立租户验证真实 SQL。
 * 所有 DDL、测试数据和源记录变化最终 ROLLBACK，不提交业务迁移。
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { readApiConfigFile } from '../../../dist/config/env.js';
import { createDatabasePool, quoteIdentifier } from '../../../dist/infrastructure/postgres.js';
import { CollectionRepository } from '../../../dist/knowledge/collection/repository.js';
import { CollectionService } from '../../../dist/knowledge/collection/service.js';
import { IngestionRepository } from '../../../dist/knowledge/persistence/ingestionRepository.js';
import { KnowledgeRepository } from '../../../dist/knowledge/catalog/knowledgeRepository.js';
import { createCollectionGraph } from '../../../dist/knowledge/collection/graph/graph.js';
import { caseMarkdown } from '../../../dist/knowledge/collection/policy.js';
import { parseKnowledgeDocument } from '../../../dist/knowledge/ingestion/documentParser.js';
import { PostgresKnowledgeSearch } from '../../../dist/knowledge/retrieval/postgresKnowledgeSearch.js';

const config = readApiConfigFile(new URL('../../../.env', import.meta.url));
const pool = createDatabasePool(config.database, { registerVectorTypes: false });
const client = await pool.connect();
const schemaName = `case_regression_${randomUUID().replaceAll('-', '')}`;
const schema = quoteIdentifier(schemaName);
const table = (name) => `${schema}.${quoteIdentifier(name)}`;
const tenant = randomUUID();
const group = randomUUID();
const library = randomUUID();
const audio = randomUUID();
const revision = randomUUID();
const confirmation = randomUUID();
const scene = randomUUID();
const job = randomUUID();
const tag = randomUUID();
const segmentIds = [randomUUID(), randomUUID()];
// 仓储内事务改用 savepoint，任何路径都不能提交外层测试事务。
let savepoint = 0;
const stack = [];
let queryTail = Promise.resolve();
const sequentialQuery = (sql, values) => {
  const result = queryTail.then(() => client.query(sql, values));
  queryTail = result.catch(() => undefined);
  return result;
};
const facade = {
  query: async (sql, values) => {
    if (sql === 'BEGIN') {
      const name = `case_test_${++savepoint}`;
      stack.push(name);
      return client.query(`SAVEPOINT ${name}`);
    }
    if (sql === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${stack.pop()}`);
    if (sql === 'ROLLBACK') {
      const name = stack.pop();
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      return client.query(`RELEASE SAVEPOINT ${name}`);
    }
    return sequentialQuery(sql, values);
  },
  release: () => undefined,
};
const adapter = { query: sequentialQuery, connect: async () => facade };
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='3s'");
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET LOCAL search_path TO ${schema},public`);
  for (const name of (await readdir(new URL('../../../migrations/', import.meta.url)))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    await client.query(
      await readFile(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8'),
    );
  }
  await client.query(`INSERT INTO ${table('tenants')}(id,name) VALUES($1,'Case regression')`, [
    tenant,
  ]);
  await client.query(
    `INSERT INTO ${table('groups')}(id,tenant_id,name) VALUES($1,$2,'Regression')`,
    [group, tenant],
  );
  await client.query(
    `INSERT INTO ${table('knowledge_bases')}(id,tenant_id,name) VALUES($1,$2,'Regression')`,
    [library, tenant],
  );
  await client.query(
    `INSERT INTO ${table('audio_files')}(id,tenant_id,title,upload_status) VALUES($1,$2,'Synthetic audio','ready')`,
    [audio, tenant],
  );
  await client.query(
    `INSERT INTO ${table('audio_analysis_revisions')}(id,tenant_id,audio_file_id,revision_no,transcription_model,analysis_model,status) VALUES($1,$2,$3,1,'qwen3-asr-flash-filetrans','deepseek-v4-flash','ready')`,
    [revision, tenant, audio],
  );
  await client.query(
    `INSERT INTO ${table('transcript_confirmations')}(id,tenant_id,analysis_revision_id,version_no) VALUES($1,$2,$3,1)`,
    [confirmation, tenant, revision],
  );
  await client.query(
    `INSERT INTO ${table('analysis_scenes')}(id,tenant_id,analysis_revision_id,scene_index,title,start_ms) VALUES($1,$2,$3,1,'Synthetic',0)`,
    [scene, tenant, revision],
  );
  for (const [i, id] of segmentIds.entries()) {
    const text = i ? 'We can compare the total cost before you decide.' : 'This feels expensive.';
    await client.query(
      `INSERT INTO ${table('transcript_segments')}(id,tenant_id,analysis_revision_id,scene_id,segment_index,speaker_key,speaker_label,start_ms,end_ms,text) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)`,
      [id, tenant, revision, scene, i + 1, `speaker-${i}`, i * 1000, (i + 1) * 1000, text],
    );
    await client.query(
      `INSERT INTO ${table('transcript_confirmation_segments')}(tenant_id,transcript_confirmation_id,analysis_revision_id,source_transcript_segment_id,confirmed_segment_id,part_index,speaker_key,start_word_index,end_word_index,start_ms,end_ms,text) VALUES($1,$2,$3,$4,$4,1,$5,0,1,$6,$7,$8)`,
      [tenant, confirmation, revision, id, `speaker-${i}`, i * 1000, (i + 1) * 1000, text],
    );
  }
  await client.query(
    `INSERT INTO ${table('audio_business_analysis_jobs')}(id,tenant_id,group_id,audio_file_id,analysis_revision_id,transcript_confirmation_id,confirmation_version,model,input_fingerprint,settings_snapshot,status) VALUES($1,$2,$3,$4,$5,$6,1,'deepseek-v4-flash','synthetic','{}','running')`,
    [job, tenant, group, audio, revision, confirmation],
  );
  await client.query(
    `INSERT INTO ${table('business_analysis_tags')}(id,tenant_id,job_id,tag_index,category,title,summary,confidence) VALUES($1,$2,$3,1,'strength','Cost comparison','Responds to the price objection.',90)`,
    [tag, tenant, job],
  );
  await client.query(
    `INSERT INTO ${table('business_analysis_tag_segments')}(tenant_id,job_id,tag_id,analysis_revision_id,transcript_confirmation_id,confirmed_segment_id) VALUES($1,$2,$3,$4,$5,$6)`,
    [tenant, job, tag, revision, confirmation, segmentIds[1]],
  );
  const repository = new CollectionRepository(adapter, schemaName, tenant);
  const ingestion = new IngestionRepository(adapter, schemaName, tenant);
  const knowledge = new KnowledgeRepository(adapter, schemaName, tenant);
  const service = new CollectionService(
    repository,
    ingestion,
    { retryDocument: (...args) => ingestion.retryDocument(...args) },
    { resolveCapability: async () => ({ model: 'synthetic-embedding', revisionId: null }) },
    {},
  );
  let rule = await repository.saveRule(group, {
    name: 'Strengths',
    enabled: true,
    mode: 'review',
    category: { id: 'strength', name: 'Strength' },
    knowledgeBaseId: library,
    filters: {
      sources: ['strength'],
      customLabels: [],
      dataSourceIds: [],
      minimumConfidence: null,
      keywords: [],
    },
  });
  await client.query(
    `UPDATE ${table('audio_business_analysis_jobs')} SET status='ready',published_at=now() WHERE id=$1`,
    [job],
  );
  const event = await repository.claim();
  assert.equal(event.kind, 'source');
  assert.equal(event.payload.rules[0].input.mode, 'review');
  rule = await repository.saveRule(
    group,
    {
      name: rule.name,
      enabled: true,
      mode: 'direct',
      category: rule.category,
      knowledgeBaseId: library,
      filters: rule.filters,
    },
    rule.id,
    rule.version,
  );
  await createCollectionGraph(service).invoke({ task: event });
  let item = (await repository.listCases(library)).items[0];
  assert.equal(item.status, 'candidate');
  await service.collectTask(event);
  assert.equal((await repository.listCases(library)).items.length, 1);
  const source = (await repository.sources(job))[0];
  item = await repository.action(item.id, item.version, 'reject');
  await repository.collect(source, rule, 'automatic');
  assert.equal((await repository.getCase(item.id)).status, 'rejected');
  const manual = await repository.collect(
    { ...source, tagId: null, segmentIds },
    { ...rule, mode: 'review' },
    'manual',
  );
  let published = await repository.action(manual.id, manual.version, 'publish');
  const task = { payload: { caseId: published.id, version: published.version } };
  await service.projectTask(task);
  await service.projectTask(task);
  published = await repository.getCase(published.id);
  assert.ok(published.documentId);
  assert.equal(
    (
      await client.query(
        `SELECT count(*)::int AS n FROM ${table('documents')} WHERE tenant_id=$1`,
        [tenant],
      )
    ).rows[0].n,
    1,
  );
  const ingestionJob = await ingestion.claimIngestionJob();
  const snapshot = await parseKnowledgeDocument(
    Buffer.from(caseMarkdown(published.id, published.content)),
    'markdown',
    published.content.title,
  );
  const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  await ingestion.publishRevision({
    job: ingestionJob,
    chunks: snapshot.chunks,
    vectors: snapshot.chunks.map(() => vector),
    previewText: snapshot.previewText,
    warnings: [],
    provider: 'synthetic',
    embeddingTokens: 0,
    estimatedCost: { amount: 0, currency: 'CNY' },
    embeddingModel: 'synthetic-embedding',
  });
  const search = new PostgresKnowledgeSearch(adapter, schemaName, tenant);
  assert.ok(
    (await search.searchMany([library], vector, 'synthetic-embedding')).some(
      (hit) => hit.documentId === published.documentId,
    ),
  );
  published = await repository.getCase(published.id);
  assert.equal(published.publication, 'ready');
  const beforeReadyRetry = await client.query(
    `SELECT id,status FROM ${table('collection_tasks')} WHERE kind='projection' AND payload->>'caseId'=$1`,
    [published.id],
  );
  await client.query(`UPDATE ${table('collection_tasks')} SET status='completed' WHERE id=$1`, [
    beforeReadyRetry.rows[0].id,
  ]);
  await repository.retryCase(published.id, published.version);
  assert.equal(
    (
      await client.query(`SELECT status FROM ${table('collection_tasks')} WHERE id=$1`, [
        beforeReadyRetry.rows[0].id,
      ])
    ).rows[0].status,
    'completed',
  );
  await assert.rejects(
    ingestion.retryDocument(library, published.documentId, {
      id: published.id,
      version: published.version - 1,
    }),
    /版本/,
  );
  const active = (await knowledge.getDocument(library, published.documentId)).activeRevisionId;
  published = await repository.updateCase(published.id, published.version, {
    ...published.content,
    reason: 'Human edited rationale.',
  });
  await service.projectTask({ payload: { caseId: published.id, version: published.version } });
  assert.equal(
    (await knowledge.getDocument(library, published.documentId)).activeRevisionId,
    active,
  );
  await assert.rejects(
    repository.updateCase(published.id, published.version - 1, published.content),
    /版本/,
  );
  await assert.rejects(ingestion.getRevisionSource(library, published.documentId), /案例入口/);
  const correction = await repository.saveCorrection(job, tag, {
    expectedVersion: 0,
    category: 'improvement',
    customLabel: null,
    reason: 'Human interpretation.',
    suggestedReply: 'Ask about their budget first.',
  });
  assert.equal(correction.version, 1);
  await assert.rejects(
    repository.saveCorrection(job, tag, {
      expectedVersion: 0,
      category: 'improvement',
      customLabel: null,
      reason: 'Stale write.',
      suggestedReply: '',
    }),
    /版本/,
  );
  const ruleInput = {
    name: rule.name,
    enabled: true,
    mode: 'manual',
    category: rule.category,
    knowledgeBaseId: library,
    filters: rule.filters,
  };
  rule = await repository.saveRule(group, ruleInput, rule.id, rule.version);
  const taskCount = async () =>
    (await client.query(`SELECT count(*)::int AS n FROM ${table('collection_tasks')}`)).rows[0].n;
  const beforeManual = await taskCount();
  await repository.saveCorrection(job, tag, {
    expectedVersion: 1,
    category: 'improvement',
    customLabel: null,
    reason: 'Second human interpretation.',
    suggestedReply: 'Ask about their budget first.',
  });
  assert.equal(await taskCount(), beforeManual);
  rule = await repository.saveRule(group, { ...ruleInput, mode: 'direct' }, rule.id, rule.version);
  const newerJob = randomUUID();
  const newerTag = randomUUID();
  await client.query(
    `INSERT INTO ${table('audio_business_analysis_jobs')}
    (id,tenant_id,group_id,audio_file_id,analysis_revision_id,transcript_confirmation_id,
    confirmation_version,model,input_fingerprint,settings_snapshot,status)
    SELECT $1,tenant_id,group_id,audio_file_id,analysis_revision_id,transcript_confirmation_id,
    confirmation_version,model,'rerun',settings_snapshot,'running'
    FROM ${table('audio_business_analysis_jobs')} WHERE id=$2`,
    [newerJob, job],
  );
  await client.query(
    `INSERT INTO ${table('business_analysis_tags')}
    (id,tenant_id,job_id,tag_index,category,title,summary,confidence)
    SELECT $1,tenant_id,$2,tag_index,category,title,summary,confidence
    FROM ${table('business_analysis_tags')} WHERE id=$3`,
    [newerTag, newerJob, tag],
  );
  await client.query(
    `INSERT INTO ${table('business_analysis_tag_segments')}
    (tenant_id,job_id,tag_id,analysis_revision_id,transcript_confirmation_id,confirmed_segment_id)
    SELECT tenant_id,$1,$2,analysis_revision_id,transcript_confirmation_id,confirmed_segment_id
    FROM ${table('business_analysis_tag_segments')} WHERE tag_id=$3`,
    [newerJob, newerTag, tag],
  );
  await client.query(
    `UPDATE ${table('audio_business_analysis_jobs')} SET status='ready',
    published_at=clock_timestamp() WHERE id=$1`,
    [newerJob],
  );
  // 这里只终结测试任务，确保真实领取器选到待验证的新事件。
  await client.query(
    `UPDATE ${table('collection_tasks')} SET status='completed'
    WHERE kind<>'source' OR payload->>'jobId'<>$1`,
    [newerJob],
  );
  const freshEvent = await repository.claim();
  await createCollectionGraph(service).invoke({ task: freshEvent });
  const direct = (await repository.listCases(library)).items.find(
    (entry) => entry.source.jobId === newerJob,
  );
  assert.equal(direct.status, 'published');
  assert.equal(direct.source.collectionMode, 'direct');
  assert.equal((await repository.getCase(published.id)).sourceUpdated, true);
  assert.equal((await repository.listCorrections(job, tag)).items[0].version, 2);
  const range = {
    ruleId: rule.id,
    from: '2000-01-01T00:00:00Z',
    to: '2100-01-01T00:00:00Z',
  };
  const history = await repository.historySources(group, range);
  assert.ok(history.every((entry) => entry.jobId === newerJob));
  assert.deepEqual(await service.history(group, range, false), { count: 1 });
  const run = await service.history(group, range, true);
  await client.query(
    `UPDATE ${table('collection_tasks')} SET status='completed' WHERE run_id IS DISTINCT FROM $1`,
    [run.id],
  );
  const historyTask = await repository.claim();
  await client.query(
    `UPDATE ${table('collection_tasks')} SET lease_until=now()-interval '1 minute' WHERE id=$1`,
    [historyTask.id],
  );
  const resumed = await repository.claim();
  assert.equal(resumed.id, historyTask.id);
  assert.notEqual(resumed.leaseToken, historyTask.leaseToken);
  await assert.rejects(repository.taskState(historyTask, 'completed', 'done'), /租约/);
  await createCollectionGraph(service).invoke({ task: resumed });
  assert.equal((await repository.listCases(library)).items.length, 3);
  assert.equal(
    (await repository.listRuns(group)).items.find((entry) => entry.id === run.id).status,
    'completed',
  );
  // 两条规则共享同一个案例及文档，目录链接不触发入库。
  const secondRule = await repository.saveRule(group, {
    ...ruleInput,
    mode: 'direct',
    name: 'Second rule',
  });
  const currentSource = (await repository.sources(newerJob))[0];
  const secondEvent = {
    payload: {
      jobId: newerJob,
      rules: [
        {
          id: secondRule.id,
          version: secondRule.version,
          input: { ...ruleInput, mode: 'direct', name: secondRule.name },
        },
      ],
    },
  };
  await service.collectTask(secondEvent);
  assert.equal((await repository.listCases(library)).items.length, 3);
  let directory = await repository.folders.directory(library);
  assert.equal(
    directory.items.filter((entry) => entry.kind === 'folder' && entry.folder.kind === 'rule')
      .length,
    2,
  );
  const firstFolder = directory.items.find(
    (entry) => entry.kind === 'folder' && entry.folder.ruleId === rule.id,
  ).folder;
  const secondFolder = directory.items.find(
    (entry) => entry.kind === 'folder' && entry.folder.ruleId === secondRule.id,
  ).folder;
  assert.equal(
    (await repository.folders.contents(library, firstFolder.id)).items[0].caseId,
    direct.id,
  );
  assert.equal(
    (await repository.folders.contents(library, secondFolder.id, 'Cost comparison')).items[0]
      .caseId,
    direct.id,
  );
  const tasksBefore = await taskCount();
  const oldCase = await repository.collect(
    { ...currentSource, tagId: null },
    { ...ruleInput, mode: 'direct', category: { id: 'legacy-example', name: 'Legacy' } },
    'automatic',
  );
  const legacyFolder = (await repository.folders.directory(library)).items.find(
    (entry) => entry.kind === 'folder' && entry.folder.kind === 'legacy',
  ).folder;
  const failed = await repository.folders.organize(library, legacyFolder.id, {
    ruleId: rule.id,
    items: [{ id: oldCase.id, expectedVersion: oldCase.version + 1 }],
  });
  assert.equal(failed.items[0].success, false);
  const beforeOrganize = await taskCount();
  const organized = await repository.folders.organize(library, legacyFolder.id, {
    ruleId: rule.id,
    items: [{ id: oldCase.id, expectedVersion: oldCase.version }],
  });
  assert.equal(organized.items[0].success, true);
  assert.equal(await taskCount(), beforeOrganize);
  assert.equal((await repository.getCase(oldCase.id)).documentId, oldCase.documentId);
  assert.equal((await repository.folders.contents(library, legacyFolder.id)).items.length, 0);
  const renamed = await repository.saveRule(
    group,
    { ...ruleInput, mode: 'direct', name: 'Renamed rule' },
    rule.id,
    rule.version,
  );
  assert.equal(
    (await repository.folders.contents(library, firstFolder.id)).folder.name,
    renamed.name,
  );
  await repository.action(oldCase.id, oldCase.version, 'withdraw');
  assert.ok(tasksBefore <= beforeOrganize);
  await assert.rejects(
    new CollectionRepository(adapter, schemaName, randomUUID()).folders.directory(library),
    /不存在/,
  );
  assert.ok((await repository.cleanupKeys(direct.id)).length === 0);
  await repository.action(direct.id, direct.version, 'withdraw');
  assert.equal((await repository.folders.contents(library, secondFolder.id)).items.length, 0);
  await knowledge.deleteDocument(library, published.documentId);
  assert.equal((await repository.getCase(published.id)).status, 'deleted');
  assert.equal((await search.searchMany([library], vector, 'synthetic-embedding')).length, 0);
  const otherTenant = new CollectionRepository(adapter, schemaName, randomUUID());
  await assert.rejects(otherTenant.getCase(published.id), /不存在/);
  const cleanup = await client.query(
    `SELECT 1 FROM ${table('collection_tasks')} WHERE tenant_id=$1 AND kind='cleanup'`,
    [tenant],
  );
  assert.ok(cleanup.rowCount);
  assert.ok((await repository.cleanupKeys(published.id)).length > 0);
  console.log(
    'PostgreSQL regression passed: migrations, outbox, frozen rules, dedupe, review, projection, retrieval, versions, correction, deletion and tenant isolation.',
  );
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
