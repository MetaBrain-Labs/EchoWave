-- 建立固定租户设备登记、通知事件和逐设备投递 outbox。
CREATE TABLE push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  expo_push_token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, expo_push_token)
);

CREATE TABLE notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_id uuid NOT NULL,
  task_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'HARD_BLOCKED', 'FAILED', 'COMPLETED', 'PARTIAL_COMPLETED'
  )),
  dedupe_key text NOT NULL,
  title varchar(120) NOT NULL,
  body varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, batch_id)
    REFERENCES audio_analysis_batches(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, task_id)
    REFERENCES audio_analysis_tasks(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  device_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'ticketed', 'delivered', 'retry', 'failed'
  )),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  expo_ticket_id text,
  receipt_due_at timestamptz,
  last_error_code text,
  last_error_message varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, event_id, device_id),
  FOREIGN KEY (tenant_id, event_id)
    REFERENCES notification_events(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, device_id)
    REFERENCES push_devices(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX notification_deliveries_due_idx
  ON notification_deliveries (tenant_id, status, next_attempt_at)
  WHERE status IN ('pending', 'retry', 'ticketed');

CREATE OR REPLACE FUNCTION notify_push_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('pending', 'retry', 'ticketed')
     AND NEW.next_attempt_at <= clock_timestamp() THEN
    PERFORM pg_notify(
      'echowave_worker_jobs',
      json_build_object(
        'schema', TG_TABLE_SCHEMA,
        'tenantId', NEW.tenant_id,
        'queue', 'push-notifications'
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_deliveries_worker_notify
AFTER INSERT OR UPDATE ON notification_deliveries
FOR EACH ROW EXECUTE FUNCTION notify_push_notification_delivery();
