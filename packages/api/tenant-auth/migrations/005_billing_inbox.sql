-- Deduplicated Stripe webhook inbox. One row per verified event id; an event is
-- claimed before any tenant mutation and marked processed only after it lands.
-- Failed rows may be reclaimed on Stripe's retry, so no partial state silently
-- counts as delivered.

CREATE TABLE IF NOT EXISTS wiseai_billing_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  event_created timestamptz,
  status text NOT NULL DEFAULT 'processing',
  attempts integer NOT NULL DEFAULT 1,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS wiseai_billing_events_status_idx
  ON wiseai_billing_events (status, received_at DESC);
