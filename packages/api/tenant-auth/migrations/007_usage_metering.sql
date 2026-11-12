-- Metering and control-plane foundation. Rows are append-only usage facts and
-- runtime records; admin statistics are derived from them, never from UI state.

CREATE TABLE IF NOT EXISTS wiseai_entitlements (
  tenant_id text PRIMARY KEY REFERENCES wiseai_tenants(tenant_id) ON DELETE CASCADE,
  concurrent_agents integer NOT NULL DEFAULT 1,
  monthly_compute_minutes integer NOT NULL DEFAULT 0,
  max_scheduled_jobs integer NOT NULL DEFAULT 0,
  allowed_tools text[] NOT NULL DEFAULT '{}',
  allowed_models text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wiseai_usage_events (
  usage_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES wiseai_tenants(tenant_id) ON DELETE CASCADE,
  session_id text,
  run_id text,
  kind text NOT NULL,
  provider text,
  model text,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  compute_ms bigint NOT NULL DEFAULT 0,
  cost_microusd bigint NOT NULL DEFAULT 0,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wiseai_usage_events_tenant_time_idx
  ON wiseai_usage_events (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wiseai_agent_runs (
  run_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES wiseai_tenants(tenant_id) ON DELETE CASCADE,
  session_id text,
  parent_run_id text,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text
);

CREATE INDEX IF NOT EXISTS wiseai_agent_runs_tenant_idx
  ON wiseai_agent_runs (tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS wiseai_worker_leases (
  lease_id text PRIMARY KEY,
  worker_id text NOT NULL,
  tenant_id text,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS wiseai_approval_requests (
  approval_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES wiseai_tenants(tenant_id) ON DELETE CASCADE,
  session_id text,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text
);

CREATE INDEX IF NOT EXISTS wiseai_approval_requests_tenant_idx
  ON wiseai_approval_requests (tenant_id, status, created_at DESC);
