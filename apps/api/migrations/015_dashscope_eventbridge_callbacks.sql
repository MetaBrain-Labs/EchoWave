-- 将 DashScope 异步任务完成事件持久化到 revision，支持无轮询的可恢复完成流程。
ALTER TABLE audio_analysis_revisions
  ADD COLUMN provider_callback_event_id text,
  ADD COLUMN provider_callback_status text,
  ADD COLUMN provider_callback_received_at timestamptz,
  ADD COLUMN provider_callback_result_url text,
  ADD COLUMN provider_callback_error_code text,
  ADD COLUMN provider_callback_error_message text;

ALTER TABLE audio_analysis_revisions
  ADD CONSTRAINT audio_analysis_revisions_provider_callback_status_check
    CHECK (
      provider_callback_status IS NULL OR provider_callback_status IN (
        'SUCCEEDED', 'FAILED', 'CANCELED', 'UNKNOWN'
      )
    ),
  ADD CONSTRAINT audio_analysis_revisions_provider_callback_shape_check
    CHECK (
      (provider_callback_event_id IS NULL AND provider_callback_status IS NULL
        AND provider_callback_received_at IS NULL AND provider_callback_result_url IS NULL
        AND provider_callback_error_code IS NULL AND provider_callback_error_message IS NULL)
      OR
      (provider_callback_event_id IS NOT NULL AND provider_callback_status IS NOT NULL
        AND provider_callback_received_at IS NOT NULL)
    );

ALTER TABLE audio_analysis_revisions
  DROP CONSTRAINT audio_analysis_revisions_processing_stage_check;

ALTER TABLE audio_analysis_revisions
  ADD CONSTRAINT audio_analysis_revisions_processing_stage_check
    CHECK (
      processing_stage IS NULL OR processing_stage IN (
        'queued', 'preprocessing', 'transcribing', 'awaiting_callback', 'validating',
        'correcting', 'splitting', 'merging', 'publishing'
      )
    );
