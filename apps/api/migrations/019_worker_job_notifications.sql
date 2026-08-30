-- 为 PostgreSQL 权威任务表增加提交后唤醒信号；通知不是任务事实，worker 仍需通过 SKIP LOCKED 领取。
CREATE OR REPLACE FUNCTION notify_echowave_worker_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_row jsonb := to_jsonb(NEW);
  old_row jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  queue_name text := TG_ARGV[0];
  should_notify boolean := false;
BEGIN
  IF queue_name = 'audio-post-analysis' THEN
    queue_name := CASE new_row->>'analysis_type'
      WHEN 'emotion' THEN 'audio-emotion-analysis'
      WHEN 'role' THEN 'audio-role-analysis'
      ELSE NULL
    END;
  END IF;

  IF TG_TABLE_NAME = 'audio_analysis_revisions' THEN
    should_notify :=
      (new_row->>'status' = 'queued' AND old_row->>'status' IS DISTINCT FROM 'queued')
      OR (
        new_row->>'provider_terminal_received_at' IS NOT NULL
        AND old_row->>'provider_terminal_received_at'
          IS DISTINCT FROM new_row->>'provider_terminal_received_at'
      )
      OR (
        new_row->>'provider_next_poll_at' IS NOT NULL
        AND (new_row->>'provider_next_poll_at')::timestamptz <= clock_timestamp()
        AND old_row->>'provider_next_poll_at'
          IS DISTINCT FROM new_row->>'provider_next_poll_at'
      );
  ELSE
    should_notify :=
      new_row->>'status' = 'queued' AND old_row->>'status' IS DISTINCT FROM 'queued';
  END IF;

  IF should_notify AND queue_name IS NOT NULL THEN
    PERFORM pg_notify(
      'echowave_worker_jobs',
      json_build_object(
        'schema', TG_TABLE_SCHEMA,
        'tenantId', new_row->>'tenant_id',
        'queue', queue_name
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ingestion_jobs_worker_notify
AFTER INSERT OR UPDATE ON ingestion_jobs
FOR EACH ROW EXECUTE FUNCTION notify_echowave_worker_job('knowledge-ingestion');

CREATE TRIGGER audio_analysis_revisions_worker_notify
AFTER INSERT OR UPDATE ON audio_analysis_revisions
FOR EACH ROW EXECUTE FUNCTION notify_echowave_worker_job('audio-transcription');

CREATE TRIGGER audio_post_analysis_jobs_worker_notify
AFTER INSERT OR UPDATE ON audio_post_analysis_jobs
FOR EACH ROW EXECUTE FUNCTION notify_echowave_worker_job('audio-post-analysis');

CREATE TRIGGER audio_business_analysis_jobs_worker_notify
AFTER INSERT OR UPDATE ON audio_business_analysis_jobs
FOR EACH ROW EXECUTE FUNCTION notify_echowave_worker_job('audio-business-analysis');
