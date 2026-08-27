ALTER TABLE transcript_segments
  ADD COLUMN business_role text NOT NULL DEFAULT 'unknown';

CREATE UNIQUE INDEX audio_analysis_revisions_single_active_job_idx
  ON audio_analysis_revisions (tenant_id, audio_file_id)
  WHERE status IN ('queued', 'transcribing', 'analyzing');

UPDATE data_sources
SET transcription_model = 'google/gemini-2.5-flash-lite', updated_at = now()
WHERE transcription_model <> 'google/gemini-2.5-flash-lite';
