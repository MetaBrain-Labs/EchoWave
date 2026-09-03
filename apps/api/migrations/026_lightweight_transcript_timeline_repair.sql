-- 修复已执行旧迁移的轻量本地确认快照顺序，避免声学窗口收到倒序时间戳。
UPDATE transcript_confirmation_segments confirmed
SET part_index = (
  SELECT raw.segment_index
  FROM transcript_segments raw
  WHERE raw.tenant_id = confirmed.tenant_id
    AND raw.analysis_revision_id = confirmed.analysis_revision_id
    AND raw.id = confirmed.source_transcript_segment_id
)
WHERE confirmed.transcript_confirmation_id IN (
  SELECT tc.id
  FROM transcript_confirmations tc
  JOIN audio_analysis_revisions ar
    ON ar.tenant_id = tc.tenant_id AND ar.id = tc.analysis_revision_id
  JOIN audio_files af
    ON af.tenant_id = ar.tenant_id AND af.id = ar.audio_file_id
  WHERE tc.tenant_id = confirmed.tenant_id
    AND tc.id = confirmed.transcript_confirmation_id
    AND tc.origin = 'system_raw_snapshot'
    AND tc.version_no = 1
    AND af.runtime_mode = 'lightweight_local'
)
AND EXISTS (
  SELECT 1
  FROM transcript_segments raw
  WHERE raw.tenant_id = confirmed.tenant_id
    AND raw.analysis_revision_id = confirmed.analysis_revision_id
    AND raw.id = confirmed.source_transcript_segment_id
);
