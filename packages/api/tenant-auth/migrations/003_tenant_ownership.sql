-- Tenant ownership of Sessions and Workspaces. Every statement is idempotent
-- because the plugin applies the migration set on startup. The tenant access
-- policy hydrates its in-memory ownership cache from these tables; the first
-- claim of one resource wins, and a later claim keeps the recorded owner.
-- user_id intentionally has no foreign key: ownership outlives the account
-- that created the resource, and only the tenant remains authoritative.

CREATE TABLE IF NOT EXISTS wiseai_session_owners (
  session_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES wiseai_tenants(tenant_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wiseai_session_owners_tenant_idx
  ON wiseai_session_owners (tenant_id);

CREATE TABLE IF NOT EXISTS wiseai_workspace_owners (
  workspace_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES wiseai_tenants(tenant_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wiseai_workspace_owners_tenant_idx
  ON wiseai_workspace_owners (tenant_id);
