-- 修复轻量本地 ASR 发布时未激活系统确认快照的问题，并恢复 bundled 情绪结果指针。

INSERT INTO transcript_confirmations (tenant_id, analysis_revision_id, version_no, origin)
SELECT ar.tenant_id, ar.id, 1, 'system_raw_snapshot'
FROM audio_analysis_revisions ar
JOIN audio_files af
  ON af.tenant_id = ar.tenant_id AND af.id = ar.audio_file_id
WHERE af.runtime_mode = 'lightweight_local'
  AND ar.status = 'ready'
  AND NOT EXISTS (
    SELECT 1
    FROM transcript_confirmations tc
    WHERE tc.tenant_id = ar.tenant_id
      AND tc.analysis_revision_id = ar.id
  );

INSERT INTO transcript_confirmation_segments (
  tenant_id,
  transcript_confirmation_id,
  analysis_revision_id,
  source_transcript_segment_id,
  confirmed_segment_id,
  part_index,
  speaker_key,
  start_word_index,
  end_word_index,
  start_ms,
  end_ms,
  text
)
SELECT tc.tenant_id,
       tc.id,
       ar.id,
       ts.id,
       ts.id,
       1,
       ts.speaker_key,
       0,
       greatest(jsonb_array_length(ts.words), 1),
       ts.start_ms,
       ts.end_ms,
       ts.text
FROM transcript_confirmations tc
JOIN audio_analysis_revisions ar
  ON ar.tenant_id = tc.tenant_id AND ar.id = tc.analysis_revision_id
JOIN audio_files af
  ON af.tenant_id = ar.tenant_id AND af.id = ar.audio_file_id
JOIN transcript_segments ts
  ON ts.tenant_id = ar.tenant_id AND ts.analysis_revision_id = ar.id
WHERE af.runtime_mode = 'lightweight_local'
  AND ar.status = 'ready'
  AND tc.origin = 'system_raw_snapshot'
  AND tc.version_no = 1
ON CONFLICT DO NOTHING;

-- 早期轻量模式快照曾把所有 part_index 写成 1；按原始片段序号修复，保证详情与声学窗口沿时间轴处理。
UPDATE transcript_confirmation_segments confirmed
SET part_index = (
  SELECT raw.segment_index
  FROM transcript_segments raw
  WHERE raw.tenant_id = confirmed.tenant_id
    AND raw.analysis_revision_id = confirmed.analysis_revision_id
    AND raw.id = confirmed.source_transcript_segment_id
)
FROM transcript_confirmations tc
JOIN audio_analysis_revisions ar
  ON ar.tenant_id = tc.tenant_id AND ar.id = tc.analysis_revision_id
JOIN audio_files af
  ON af.tenant_id = ar.tenant_id AND af.id = ar.audio_file_id
WHERE confirmed.tenant_id = tc.tenant_id
  AND confirmed.transcript_confirmation_id = tc.id
  AND tc.origin = 'system_raw_snapshot'
  AND tc.version_no = 1
  AND af.runtime_mode = 'lightweight_local'
  AND EXISTS (
    SELECT 1
    FROM transcript_segments raw
    WHERE raw.tenant_id = confirmed.tenant_id
      AND raw.analysis_revision_id = confirmed.analysis_revision_id
      AND raw.id = confirmed.source_transcript_segment_id
  );

UPDATE audio_analysis_revisions ar
SET active_transcript_confirmation_id = tc.id
FROM transcript_confirmations tc
WHERE ar.tenant_id = tc.tenant_id
  AND ar.id = tc.analysis_revision_id
  AND ar.status = 'ready'
  AND ar.active_transcript_confirmation_id IS NULL
  AND tc.origin = 'system_raw_snapshot'
  AND tc.version_no = 1
  AND EXISTS (
    SELECT 1
    FROM audio_files af
    WHERE af.tenant_id = ar.tenant_id
      AND af.id = ar.audio_file_id
      AND af.runtime_mode = 'lightweight_local'
  );

UPDATE audio_analysis_revisions ar
SET active_transcript_confirmation_id = latest.id
FROM (
  SELECT DISTINCT ON (tc.tenant_id, tc.analysis_revision_id)
         tc.tenant_id,
         tc.analysis_revision_id,
         tc.id
  FROM transcript_confirmations tc
  ORDER BY tc.tenant_id, tc.analysis_revision_id, tc.version_no DESC
) latest
WHERE ar.tenant_id = latest.tenant_id
  AND ar.id = latest.analysis_revision_id
  AND ar.status = 'ready'
  AND ar.active_transcript_confirmation_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM audio_files af
    WHERE af.tenant_id = ar.tenant_id
      AND af.id = ar.audio_file_id
      AND af.runtime_mode = 'lightweight_local'
  );

UPDATE audio_analysis_revisions ar
SET active_emotion_job_id = ar.bundled_emotion_job_id
WHERE ar.bundled_emotion_job_id IS NOT NULL
  AND ar.active_emotion_job_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM audio_files af
    WHERE af.tenant_id = ar.tenant_id
      AND af.id = ar.audio_file_id
      AND af.runtime_mode = 'lightweight_local'
  );
