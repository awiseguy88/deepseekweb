CREATE TABLE IF NOT EXISTS wiseai_tenants (
  tenant_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS wiseai_users (
  user_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES wiseai_tenants(tenant_id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE UNIQUE INDEX IF NOT EXISTS wiseai_users_email_ci ON wiseai_users (lower(email));

CREATE TABLE IF NOT EXISTS wiseai_sessions (
  session_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES wiseai_users(user_id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES wiseai_tenants(tenant_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wiseai_sessions_active_idx
  ON wiseai_sessions (session_id, expires_at)
  WHERE revoked_at IS NULL;
