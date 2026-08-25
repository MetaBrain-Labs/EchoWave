ALTER TABLE audio_analysis_revisions
  ADD COLUMN processing_stage text,
  ADD COLUMN current_chunk integer,
  ADD COLUMN chunk_count integer,
  ADD COLUMN current_chunk_start_ms integer,
  ADD COLUMN current_chunk_end_ms integer,
  ADD COLUMN network_attempt integer,
  ADD COLUMN structure_attempt integer,
  ADD COLUMN processing_updated_at timestamptz;

ALTER TABLE audio_analysis_revisions
  ADD CONSTRAINT audio_analysis_revisions_processing_stage_check
    CHECK (
      processing_stage IS NULL OR processing_stage IN (
        'queued', 'preprocessing', 'transcribing', 'validating', 'correcting',
        'merging', 'publishing'
      )
    ),
  ADD CONSTRAINT audio_analysis_revisions_chunk_progress_check
    CHECK (
      num_nonnulls(current_chunk, chunk_count, current_chunk_start_ms, current_chunk_end_ms)
        IN (0, 4)
      AND (
        current_chunk IS NULL OR (
          current_chunk >= 1 AND current_chunk <= chunk_count
          AND current_chunk_start_ms >= 0
          AND current_chunk_end_ms > current_chunk_start_ms
        )
      )
    ),
  ADD CONSTRAINT audio_analysis_revisions_attempt_progress_check
    CHECK (
      (network_attempt IS NULL OR network_attempt BETWEEN 1 AND 3)
      AND (structure_attempt IS NULL OR structure_attempt BETWEEN 1 AND 3)
      AND (network_attempt IS NULL OR current_chunk IS NOT NULL)
      AND (structure_attempt IS NULL OR current_chunk IS NOT NULL)
    );

UPDATE audio_analysis_revisions
SET processing_stage = CASE
      WHEN status = 'queued' THEN 'queued'
      WHEN status = 'transcribing' THEN 'preprocessing'
      WHEN status = 'analyzing' THEN 'merging'
    END,
    processing_updated_at = now()
WHERE status IN ('queued', 'transcribing', 'analyzing');
