/**
 * 音频工作区开发 seed。
 *
 * 写入上传批次、音频、处理中修订和已发布分析样例。
 *
 * Responsibilities:
 * - 构造不同上传与分析生命周期状态。
 * - 调用已发布分析 seed 完成可追溯详情。
 *
 * Notes:
 * - 事务边界由 seed 入口统一管理。
 */
import type { PoolClient } from 'pg';

import { seedPublishedAnalysis } from './analysis.ts';
import { seedIds, type SeedContext } from './types.ts';

/** 写入音频工作区及分析演示数据。 */
export async function seedAudioWorkspace(client: PoolClient, context: SeedContext): Promise<void> {
  const { table, tenantId } = context;
  const ids = seedIds;
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

  await seedPublishedAnalysis(client, context, {
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
  await seedPublishedAnalysis(client, context, {
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
}
