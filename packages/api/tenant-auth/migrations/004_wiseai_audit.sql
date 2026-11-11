-- Immutable administrative audit trail and recoverable customer deletion.
-- Every statement is idempotent because the plugin applies the full set on boot.

ALTER TABLE wiseai_tenants ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS wiseai_audit_events (
  event_id text PRIMARY KEY,
  actor_user_id text NOT NULL,
  actor_tenant_id text NOT NULL,
  action text NOT NULL,
  target_tenant_id text,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wiseai_audit_events_created_idx
  ON wiseai_audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS wiseai_audit_events_tenant_idx
  ON wiseai_audit_events (target_tenant_id, created_at DESC);
