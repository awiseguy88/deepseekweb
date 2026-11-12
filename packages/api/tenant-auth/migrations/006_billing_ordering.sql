-- Billing inbox lifecycle ordering: record which tenant an event belongs to and
-- compare its Stripe creation time with already-processed events so a delayed
-- older delivery cannot overwrite newer subscription state.

ALTER TABLE wiseai_billing_events ADD COLUMN IF NOT EXISTS target_tenant_id text;

CREATE INDEX IF NOT EXISTS wiseai_billing_events_tenant_time_idx
  ON wiseai_billing_events (target_tenant_id, event_created DESC);
