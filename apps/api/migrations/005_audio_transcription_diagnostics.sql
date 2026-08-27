ALTER TABLE audio_analysis_revisions
  ADD COLUMN error_details jsonb;

ALTER TABLE audio_analysis_revisions
  ADD CONSTRAINT audio_analysis_revisions_error_details_object_check
  CHECK (error_details IS NULL OR jsonb_typeof(error_details) = 'object');
