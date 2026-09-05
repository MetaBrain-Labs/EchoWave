-- 修复自动分析通知触发器对不同队列表结构的兼容性。
-- audio_analysis_tasks 有 phase 字段，其他队列表没有；统一通过 JSONB 读取可选字段。
CREATE OR REPLACE FUNCTION notify_audio_analysis_automation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_row jsonb := to_jsonb(NEW);
  old_row jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
BEGIN
  IF TG_OP = 'INSERT'
     OR old_row->>'status' IS DISTINCT FROM new_row->>'status'
     OR (
       TG_TABLE_NAME = 'audio_analysis_tasks'
       AND old_row->>'phase' IS DISTINCT FROM new_row->>'phase'
     ) THEN
    PERFORM pg_notify(
      'echowave_worker_jobs',
      json_build_object(
        'schema', TG_TABLE_SCHEMA,
        'tenantId', new_row->>'tenant_id',
        'queue', 'audio-analysis-automation'
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$;
