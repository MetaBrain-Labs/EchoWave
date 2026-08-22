/**
 * 音频工作区开发数据入口。
 *
 * 为固定开发租户幂等写入与移动端原型一致的分组、数据源、音频和结构化分析样例。
 *
 * Responsibilities:
 * - 提供可重复执行且不属于 migration 的演示数据初始化。
 * - 保持分析结果和当前生效版本在同一事务内一致。
 *
 * Notes:
 * - 仅用于本地开发；运行前必须先显式执行数据库迁移。
 */
import { readApiConfigFile } from '../config/env.ts';
import { createDatabasePool, quoteIdentifier } from '../infrastructure/postgres.ts';
import type { PoolClient } from 'pg';

const config = readApiConfigFile(new URL('../../.env', import.meta.url));
const pool = createDatabasePool(config.database);
const schema = quoteIdentifier(config.database.schema);
const tenantId = config.rag.tenantId;
const table = (name: string) => `${schema}.${quoteIdentifier(name)}`;

const ids = {
  groups: [
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
  ],
  sources: [
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000004',
  ],
  runs: [
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
  ],
  audio: [
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000005',
    '40000000-0000-4000-8000-000000000006',
    '40000000-0000-4000-8000-000000000007',
    '40000000-0000-4000-8000-000000000008',
    '40000000-0000-4000-8000-000000000009',
  ],
  analyses: [
    '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000004',
    '50000000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000006',
  ],
  knowledgeBase: 'b0000000-0000-4000-8000-000000000001',
} as const;

type SeedAnalysisIds = {
  analysis: string;
  audio: string;
  sceneOne: string;
  sceneTwo: string;
  segments: [string, string, string, string];
  tags: [string, string];
  invalid: string;
  summaries: [string, string, string, string, string];
  publishedAt: string;
};

/** 插入一个完整、可追溯的已发布分析修订版并原子设置为当前版本。 */
async function seedPublishedAnalysis(client: PoolClient, value: SeedAnalysisIds) {
  await client.query(
    `INSERT INTO ${table('audio_analysis_revisions')}
       (id, tenant_id, audio_file_id, revision_no, transcription_model, analysis_model,
        settings_snapshot, status, progress, completed_at, published_at)
     VALUES ($1, $2, $3, 1, 'Echo ASR Standard', 'Echo Analysis Standard',
       '{"emotionAnalysis":true,"speakerDiarization":true,"sceneSegmentation":true}',
       'ready', 100, $4, $4)
     ON CONFLICT (id) DO UPDATE SET status = 'ready', progress = 100,
       completed_at = EXCLUDED.completed_at, published_at = EXCLUDED.published_at`,
    [value.analysis, tenantId, value.audio, value.publishedAt],
  );
  await client.query(
    `INSERT INTO ${table('analysis_scenes')}
       (id, tenant_id, analysis_revision_id, scene_index, title, start_ms)
     VALUES ($1, $3, $4, 1, '开场与访谈背景', 0),
            ($2, $3, $4, 2, '整理痛点与期待', 84000)
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, start_ms = EXCLUDED.start_ms`,
    [value.sceneOne, value.sceneTwo, tenantId, value.analysis],
  );
  const segmentRows = [
    [
      value.segments[0],
      value.sceneOne,
      1,
      'host',
      '主持人',
      '专注',
      0,
      28000,
      '今天想和你聊聊最近使用团队音频整理工具的体验。先从日常工作开始，你通常会在什么场景下记录和回听访谈？',
    ],
    [
      value.segments[1],
      value.sceneOne,
      2,
      'self',
      '我',
      '平静',
      29000,
      71000,
      '最常见的是用户访谈和每周复盘。我会先完整录音，结束后再回听并整理重点，但在很长的录音里寻找关键内容会花不少时间。',
    ],
    [
      value.segments[2],
      value.sceneTwo,
      1,
      'host',
      '主持人',
      '好奇',
      84000,
      112000,
      '如果工具可以自动完成一部分整理工作，你最希望它优先解决什么问题？',
    ],
    [
      value.segments[3],
      value.sceneTwo,
      2,
      'self',
      '我',
      '期待',
      113000,
      168000,
      '我最希望先看到结构化的主题和关键观点，而且每条结论都能直接跳回对应的转写位置。',
    ],
  ] as const;
  for (const segment of segmentRows) {
    await client.query(
      `INSERT INTO ${table('transcript_segments')}
         (id, tenant_id, analysis_revision_id, scene_id, segment_index, speaker_key,
          speaker_label, emotion, start_ms, end_ms, text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, emotion = EXCLUDED.emotion`,
      [segment[0], tenantId, value.analysis, ...segment.slice(1)],
    );
  }
  const tagRows = [
    [
      value.tags[0],
      value.segments[0],
      '高频访谈记录场景',
      '受访者的工作流程依赖持续记录和会后回顾，音频整理是研究过程中的固定环节。',
      [
        '主要场景包括用户访谈、项目复盘和跨团队评审。',
        '使用者希望保留原始语境，同时快速定位能够支持结论的片段。',
      ],
    ],
    [
      value.tags[1],
      value.segments[2],
      '优先需求：快速定位证据',
      '用户最重视定位效率，希望分析结果能够回到原始转写和准确时间点。',
      [
        '总结需要与具体说话人、时间点和原始表达关联。',
        '标签应该帮助筛选，不应替代可核对的转写内容。',
      ],
    ],
  ] as const;
  for (const tag of tagRows) {
    await client.query(
      `INSERT INTO ${table('segment_ai_tags')}
         (id, tenant_id, analysis_revision_id, transcript_segment_id, title, summary, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title,
         summary = EXCLUDED.summary, details = EXCLUDED.details`,
      [tag[0], tenantId, value.analysis, tag[1], tag[2], tag[3], JSON.stringify(tag[4])],
    );
  }
  await client.query(
    `INSERT INTO ${table('analysis_invalid_segments')}
       (id, tenant_id, analysis_revision_id, start_ms, end_ms, reason)
     VALUES ($1, $2, $3, 72000, 84000, '无有效语音')
     ON CONFLICT (id) DO UPDATE SET reason = EXCLUDED.reason`,
    [value.invalid, tenantId, value.analysis],
  );
  const summaries = [
    ['访谈背景', '本次访谈围绕团队音频记录、会后整理和研究结论复核展开。'],
    ['当前工作方式', '受访者通常先保留完整录音，再通过回听手动提炼重点。'],
    ['核心痛点', '最明显的问题是整理耗时和复核路径过长。'],
    ['产品期待', '用户希望系统自动识别主题、观点和关键证据，并允许直接回到对应转写片段。'],
    ['机会判断', '优先建设可追溯的结构化分析体验，比单纯生成长摘要更有价值。'],
  ] as const;
  for (const [index, summary] of summaries.entries()) {
    await client.query(
      `INSERT INTO ${table('analysis_summary_sections')}
         (id, tenant_id, analysis_revision_id, section_index, title, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body`,
      [value.summaries[index], tenantId, value.analysis, index + 1, summary[0], summary[1]],
    );
  }
  await client.query(
    `UPDATE ${table('audio_files')}
     SET active_analysis_revision_id = $3, updated_at = $4
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, value.audio, value.analysis, value.publishedAt],
  );
}

/** 幂等写入当前静态页面对应的开发演示数据。 */
async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const groups = [
      [ids.groups[0], '产品研究组'],
      [ids.groups[1], '客户体验组'],
      [ids.groups[2], '市场洞察组'],
    ] as const;
    for (const group of groups) {
      await client.query(
        `INSERT INTO ${table('groups')} (id, tenant_id, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now(), deleted_at = NULL`,
        [group[0], tenantId, group[1]],
      );
    }

    const sources = [
      [
        ids.sources[0],
        '团队录音空间',
        '汇集团队访谈、周会与客户沟通录音。',
        'manual_upload',
        'local',
        'HTTPS API / team-audio',
      ],
      [
        ids.sources[1],
        '用户研究云盘',
        '同步研究项目中的访谈音频与观察记录。',
        'cloud_drive',
        'cloud',
        'Cloud Drive / research',
      ],
      [
        ids.sources[2],
        '客户沟通归档',
        '接入客户成功团队的沟通录音。',
        's3',
        'cloud',
        'S3 / customer-calls',
      ],
      [
        ids.sources[3],
        '市场调研资料',
        '整理市场活动与竞品调研录音。',
        'local_folder',
        'local',
        'Local Folder / market',
      ],
    ] as const;
    for (const source of sources) {
      await client.query(
        `INSERT INTO ${table('data_sources')}
           (id, tenant_id, name, description, source_type, location, connection_label,
            connection_status, transcription_model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'connected', 'Echo ASR Standard')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
           source_type = EXCLUDED.source_type, location = EXCLUDED.location,
           connection_label = EXCLUDED.connection_label, updated_at = now(), deleted_at = NULL`,
        [source[0], tenantId, ...source.slice(1)],
      );
    }

    await client.query(
      `INSERT INTO ${table('knowledge_bases')} (id, tenant_id, name, description)
       VALUES ($1, $2, '产品研究知识库', '沉淀访谈、研究计划和可追溯证据。')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
         updated_at = now(), deleted_at = NULL`,
      [ids.knowledgeBase, tenantId],
    );
    await client.query(
      `INSERT INTO ${table('group_knowledge_bases')} (tenant_id, group_id, knowledge_base_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [tenantId, ids.groups[0], ids.knowledgeBase],
    );
    const sourceLinks = [
      [ids.groups[0], ids.sources[0]],
      [ids.groups[0], ids.sources[1]],
      [ids.groups[1], ids.sources[0]],
      [ids.groups[1], ids.sources[2]],
      [ids.groups[2], ids.sources[0]],
      [ids.groups[2], ids.sources[3]],
    ];
    for (const link of sourceLinks) {
      await client.query(
        `INSERT INTO ${table('group_data_sources')} (tenant_id, group_id, data_source_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [tenantId, ...link],
      );
    }

    const runRows = [
      [ids.runs[0], 'succeeded', '2026-08-20T16:32:08.000Z'],
      [ids.runs[1], 'succeeded', '2026-08-20T11:08:41.000Z'],
      [ids.runs[2], 'failed', '2026-08-20T09:15:26.000Z'],
    ] as const;
    for (const run of runRows) {
      await client.query(
        `INSERT INTO ${table('data_source_ingestion_runs')}
           (id, tenant_id, data_source_id, trigger_kind, status, error_code, error_message,
            error_retryable, started_at, completed_at)
         VALUES ($1, $2, $3, 'manual', $4,
           CASE WHEN $4 = 'failed' THEN 'SOURCE_UNAVAILABLE' END,
           CASE WHEN $4 = 'failed' THEN '文件连接已中断' END,
           CASE WHEN $4 = 'failed' THEN true END, $5, $5)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status,
           error_code = EXCLUDED.error_code, error_message = EXCLUDED.error_message,
           completed_at = EXCLUDED.completed_at`,
        [run[0], tenantId, ids.sources[0], run[1], run[2]],
      );
    }

    const audioRows = [
      ['产品访谈分析', 1_944_000, 'ready', 100, ids.runs[0]],
      ['用户研究周会', 2_886_000, 'ready', 100, ids.runs[0]],
      ['研究方案复盘', 1_602_000, 'uploading', 48, ids.runs[1]],
      ['新用户首次使用访谈', 2_465_000, 'ready', 100, ids.runs[1]],
      ['功能概念验证', 1_178_000, 'ready', 100, ids.runs[1]],
      ['重点客户沟通', 2_112_000, 'ready', 100, ids.runs[0]],
      ['竞品体验讨论', 1_734_000, 'uploading', 25, ids.runs[0]],
      ['市场活动复盘', 3_140_000, 'ready', 100, ids.runs[0]],
      ['渠道访谈录音', 1_367_000, 'failed', 0, ids.runs[2]],
    ] as const;
    for (const [index, audio] of audioRows.entries()) {
      await client.query(
        `INSERT INTO ${table('audio_files')}
           (id, tenant_id, data_source_id, ingestion_run_id, title, original_filename,
            mime_type, duration_ms, source_external_id, upload_status, upload_progress,
            error_code, error_message, error_retryable, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'audio/mpeg', $7, $8, $9, $10,
           CASE WHEN $9 = 'failed' THEN 'UPLOAD_INTERRUPTED' END,
           CASE WHEN $9 = 'failed' THEN '音频上传失败。' END,
           CASE WHEN $9 = 'failed' THEN true END,
           $11)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title,
           duration_ms = EXCLUDED.duration_ms, upload_status = EXCLUDED.upload_status,
           upload_progress = EXCLUDED.upload_progress, deleted_at = NULL`,
        [
          ids.audio[index],
          tenantId,
          ids.sources[0],
          audio[4],
          audio[0],
          `${audio[0]}.mp3`,
          audio[1],
          `demo-audio-${index + 1}`,
          audio[2],
          audio[3],
          `2026-08-${20 - Math.floor(index / 2)}T${16 - (index % 4)}:00:00.000Z`,
        ],
      );
    }

    const transientAnalyses = [
      [ids.analyses[2], ids.audio[3], 'transcribing', 62, null, null],
      [ids.analyses[3], ids.audio[4], 'queued', 0, null, null],
      [ids.analyses[4], ids.audio[5], 'failed', 0, 'transcription', '音频编码暂不支持'],
      [ids.analyses[5], ids.audio[7], 'transcribing', 34, null, null],
    ] as const;
    for (const analysis of transientAnalyses) {
      await client.query(
        `INSERT INTO ${table('audio_analysis_revisions')}
           (id, tenant_id, audio_file_id, revision_no, transcription_model, analysis_model,
            status, progress, error_stage, error_code, error_message, error_retryable)
         VALUES ($1, $2, $3, 1, 'Echo ASR Standard', 'Echo Analysis Standard',
           $4, $5, $6, CASE WHEN $4 = 'failed' THEN 'UNSUPPORTED_CODEC' END, $7,
           CASE WHEN $4 = 'failed' THEN false END)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, progress = EXCLUDED.progress,
           error_stage = EXCLUDED.error_stage, error_code = EXCLUDED.error_code,
           error_message = EXCLUDED.error_message`,
        [analysis[0], tenantId, ...analysis.slice(1)],
      );
    }

    await seedPublishedAnalysis(client, {
      analysis: ids.analyses[0],
      audio: ids.audio[0],
      sceneOne: '60000000-0000-4000-8000-000000000001',
      sceneTwo: '60000000-0000-4000-8000-000000000002',
      segments: [
        '70000000-0000-4000-8000-000000000001',
        '70000000-0000-4000-8000-000000000002',
        '70000000-0000-4000-8000-000000000003',
        '70000000-0000-4000-8000-000000000004',
      ],
      tags: ['90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002'],
      invalid: 'a0000000-0000-4000-8000-000000000001',
      summaries: [
        '80000000-0000-4000-8000-000000000001',
        '80000000-0000-4000-8000-000000000002',
        '80000000-0000-4000-8000-000000000003',
        '80000000-0000-4000-8000-000000000004',
        '80000000-0000-4000-8000-000000000005',
      ],
      publishedAt: '2026-08-15T10:51:24.000Z',
    });
    await seedPublishedAnalysis(client, {
      analysis: ids.analyses[1],
      audio: ids.audio[1],
      sceneOne: '60000000-0000-4000-8000-000000000011',
      sceneTwo: '60000000-0000-4000-8000-000000000012',
      segments: [
        '70000000-0000-4000-8000-000000000011',
        '70000000-0000-4000-8000-000000000012',
        '70000000-0000-4000-8000-000000000013',
        '70000000-0000-4000-8000-000000000014',
      ],
      tags: ['90000000-0000-4000-8000-000000000011', '90000000-0000-4000-8000-000000000012'],
      invalid: 'a0000000-0000-4000-8000-000000000011',
      summaries: [
        '80000000-0000-4000-8000-000000000011',
        '80000000-0000-4000-8000-000000000012',
        '80000000-0000-4000-8000-000000000013',
        '80000000-0000-4000-8000-000000000014',
        '80000000-0000-4000-8000-000000000015',
      ],
      publishedAt: '2026-08-14T16:02:18.000Z',
    });

    await client.query('COMMIT');
    console.log('Seeded EchoWave audio workspace development data.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

try {
  await seed();
} finally {
  await pool.end();
}
