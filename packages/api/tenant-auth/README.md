# Tenant authentication contracts

This package defines the server-side identity and tenant-root seams used by the WiseAI deployment. It does not trust tenant IDs from browser requests: the host must resolve a session cookie through a `TenantAuthStore`, then derive `TenantRoots` from that authenticated session.

The production store is intended to use Railway Postgres through `DATABASE_URL`. Password verification belongs in the host authentication service and must use a password hash (Argon2id or an equivalent memory-hard password hash), never reversible encryption. Session tokens must be random, stored hashed, scoped to one user and tenant, and revoked on logout.

The root layout is:

```text
<DSH data root>/tenants/<tenant-id>/{sessions,workspace,credentials,failures}
```

This package contains contracts only. It is deliberately not mounted into the Web bundle until the host authentication and Remote principal integration are implemented together.
# WiseAI tenant authentication

This package provides the server-side identity seam for a hosted WiseAI deployment. Passwords are hashed with Node's built-in Argon2id implementation; browser sessions are opaque random tokens whose SHA-256 digests are stored in PostgreSQL. The `tenantAuthHandler` function is intentionally transport-neutral and can be mounted at `/auth/*` by the host WebServer.

Every authenticated record carries a tenant id. Resolve tenant-owned directories with `tenantRoots(dataRoot, tenantId)` and never accept a tenant id from a browser request. `recordTenantFailure` appends bounded JSONL diagnostics under that tenant's `failures` directory. `retryTransient` is a finite, cancellation-aware retry helper for transient provider calls; it must not wrap non-idempotent mutations.

Run `migrations/001_tenant_auth.sql` against the Railway PostgreSQL `DATABASE_URL` before enabling login. Set `WISEAI_AUTH_REQUIRED=1`, `DATABASE_URL`, and a randomly generated `WISEAI_SESSION_SECRET` (at least 32 characters) in Railway variables; the start script refuses to expose the owner-only composition when those required values are missing. On the first deployment, set `WISEAI_ADMIN_EMAIL` and `WISEAI_ADMIN_PASSWORD` (at least 12 characters) once; the plugin creates the initial admin tenant if that email is absent. Remove the password variable after bootstrap. Keep secrets and provider keys in Railway variables, never in Git.
