-- 从已部署的 EventBridge 专用字段演进为 Polling 与 EventBridge 共用的终态和调度字段。
ALTER TABLE audio_analysis_revisions
  RENAME COLUMN provider_callback_event_id TO provider_terminal_event_id;
ALTER TABLE audio_analysis_revisions
  RENAME COLUMN provider_callback_status TO provider_terminal_status;
ALTER TABLE audio_analysis_revisions
  RENAME COLUMN provider_callback_received_at TO provider_terminal_received_at;
ALTER TABLE audio_analysis_revisions
  RENAME COLUMN provider_callback_result_url TO provider_terminal_result_url;
ALTER TABLE audio_analysis_revisions
  RENAME COLUMN provider_callback_error_code TO provider_terminal_error_code;
ALTER TABLE audio_analysis_revisions
  RENAME COLUMN provider_callback_error_message TO provider_terminal_error_message;

ALTER TABLE audio_analysis_revisions
  ADD COLUMN provider_terminal_source text,
  ADD COLUMN provider_poll_attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN provider_last_polled_at timestamptz,
  ADD COLUMN provider_next_poll_at timestamptz;

UPDATE audio_analysis_revisions
SET provider_terminal_source = 'eventbridge'
WHERE provider_terminal_event_id IS NOT NULL;

ALTER TABLE audio_analysis_revisions
  DROP CONSTRAINT audio_analysis_revisions_provider_callback_status_check,
  DROP CONSTRAINT audio_analysis_revisions_provider_callback_shape_check,
  DROP CONSTRAINT audio_analysis_revisions_processing_stage_check;

UPDATE audio_analysis_revisions
SET processing_stage = 'awaiting_result'
WHERE processing_stage = 'awaiting_callback';

ALTER TABLE audio_analysis_revisions
  ADD CONSTRAINT audio_analysis_revisions_provider_terminal_source_check
    CHECK (provider_terminal_source IS NULL OR provider_terminal_source IN ('polling', 'eventbridge')),
  ADD CONSTRAINT audio_analysis_revisions_provider_terminal_status_check
    CHECK (
      provider_terminal_status IS NULL OR provider_terminal_status IN (
        'SUCCEEDED', 'FAILED', 'CANCELED', 'UNKNOWN'
      )
    ),
  ADD CONSTRAINT audio_analysis_revisions_provider_terminal_shape_check
    CHECK (
      (provider_terminal_source IS NULL AND provider_terminal_event_id IS NULL
        AND provider_terminal_status IS NULL AND provider_terminal_received_at IS NULL
        AND provider_terminal_result_url IS NULL AND provider_terminal_error_code IS NULL
        AND provider_terminal_error_message IS NULL)
      OR
      (provider_terminal_source = 'polling' AND provider_terminal_event_id IS NULL
        AND provider_terminal_status IS NOT NULL AND provider_terminal_received_at IS NOT NULL)
      OR
      (provider_terminal_source = 'eventbridge' AND provider_terminal_event_id IS NOT NULL
        AND provider_terminal_status IS NOT NULL AND provider_terminal_received_at IS NOT NULL)
    ),
  ADD CONSTRAINT audio_analysis_revisions_provider_poll_attempt_check
    CHECK (provider_poll_attempt >= 0),
  ADD CONSTRAINT audio_analysis_revisions_processing_stage_check
    CHECK (
      processing_stage IS NULL OR processing_stage IN (
        'queued', 'preprocessing', 'transcribing', 'awaiting_result', 'validating',
        'correcting', 'splitting', 'merging', 'publishing'
      )
    );
