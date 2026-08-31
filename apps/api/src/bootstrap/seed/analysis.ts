/**
 * 已发布音频分析开发 seed。
 *
 * 写入场景、转写、确认、标签、无效片段和摘要，并原子更新当前分析修订。
 *
 * Responsibilities:
 * - 构造完整可追溯的已发布分析样例。
 *
 * Notes:
 * - 事务边界由 seed 入口统一管理。
 */
import type { PoolClient } from 'pg';

import type { SeedAnalysisIds, SeedContext } from './types.ts';

/** 插入一个完整、可追溯的已发布分析修订版并原子设置为当前版本。 */
export async function seedPublishedAnalysis(
  client: PoolClient,
  context: SeedContext,
  value: SeedAnalysisIds,
) {
  const { table, tenantId } = context;
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
  const confirmation = await client.query(
    `INSERT INTO ${table('transcript_confirmations')}
       (tenant_id, analysis_revision_id, version_no, confirmed_at)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (tenant_id, analysis_revision_id, version_no)
     DO UPDATE SET confirmed_at = EXCLUDED.confirmed_at
     RETURNING id`,
    [tenantId, value.analysis, value.publishedAt],
  );
  for (const segment of segmentRows) {
    await client.query(
      `INSERT INTO ${table('transcript_confirmation_segments')}
         (tenant_id, transcript_confirmation_id, analysis_revision_id,
          transcript_segment_id, text)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, transcript_confirmation_id, transcript_segment_id)
       DO UPDATE SET text = EXCLUDED.text`,
      [tenantId, confirmation.rows[0].id, value.analysis, segment[0], segment[8]],
    );
  }
  await client.query(
    `UPDATE ${table('audio_analysis_revisions')}
     SET active_transcript_confirmation_id = $3
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, value.analysis, confirmation.rows[0].id],
  );
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
