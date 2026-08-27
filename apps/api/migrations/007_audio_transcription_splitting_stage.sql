ALTER TABLE audio_analysis_revisions
  DROP CONSTRAINT audio_analysis_revisions_processing_stage_check;

ALTER TABLE audio_analysis_revisions
  ADD CONSTRAINT audio_analysis_revisions_processing_stage_check
    CHECK (
      processing_stage IS NULL OR processing_stage IN (
        'queued', 'preprocessing', 'transcribing', 'validating', 'correcting',
        'splitting', 'merging', 'publishing'
      )
    );
