-- WiseAI hosted administration: platform operators, customer profiles, support inbox,
-- and the Stripe sales ledger. Every statement is idempotent because the plugin
-- applies the migration set on startup.

ALTER TABLE wiseai_users ADD COLUMN IF NOT EXISTS platform_admin boolean NOT NULL DEFAULT false;
ALTER TABLE wiseai_users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE wiseai_users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE wiseai_tenants ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
ALTER TABLE wiseai_tenants ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free';
ALTER TABLE wiseai_tenants ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE wiseai_tenants ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE wiseai_tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE wiseai_tenants ADD COLUMN IF NOT EXISTS access_until timestamptz;
ALTER TABLE wiseai_tenants ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE wiseai_tenants ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS wiseai_tenants_stripe_customer_idx
  ON wiseai_tenants (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wiseai_support_requests (
  request_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES wiseai_tenants(tenant_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES wiseai_users(user_id) ON DELETE CASCADE,
  email text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  page_url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  admin_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wiseai_support_requests_status_idx
  ON wiseai_support_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS wiseai_sales_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  tenant_id text REFERENCES wiseai_tenants(tenant_id) ON DELETE SET NULL,
  customer_id text,
  subscription_id text,
  amount_total integer,
  currency text,
  status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wiseai_sales_events_created_idx
  ON wiseai_sales_events (created_at DESC);
