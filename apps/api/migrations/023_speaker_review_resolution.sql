-- 记录人工完成说话人疑点复核的事实，使详情刷新后仍能显示已完成状态。
ALTER TABLE audio_analysis_revisions
  ADD COLUMN speaker_review_resolved_at timestamptz;
