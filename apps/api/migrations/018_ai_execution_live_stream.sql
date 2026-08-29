-- 为音频模型详情增加可断线续传的实时事件游标和同一次调用的关联标识。
ALTER TABLE ai_execution_events
  ADD COLUMN operation_id uuid;

UPDATE ai_execution_events
SET operation_id = id
WHERE operation_id IS NULL;

ALTER TABLE ai_execution_events
  ALTER COLUMN operation_id SET NOT NULL,
  ADD COLUMN stream_cursor bigint GENERATED ALWAYS AS IDENTITY;

ALTER TABLE ai_execution_events
  DROP CONSTRAINT ai_execution_events_event_type_check,
  DROP CONSTRAINT ai_execution_events_status_check;

ALTER TABLE ai_execution_events
  ADD CONSTRAINT ai_execution_events_event_type_check
    CHECK (event_type IN ('run', 'step', 'model_call', 'tool_call', 'reasoning_delta')),
  ADD CONSTRAINT ai_execution_events_status_check
    CHECK (status IN ('started', 'completed', 'failed', 'interrupted'));

CREATE UNIQUE INDEX ai_execution_events_stream_cursor_idx
  ON ai_execution_events (stream_cursor);

CREATE INDEX ai_execution_events_run_operation_idx
  ON ai_execution_events (tenant_id, execution_run_id, operation_id, sequence_no);
