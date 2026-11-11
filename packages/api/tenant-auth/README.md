# Tenant authentication contracts

This package defines the server-side identity and tenant-root seams used by the WiseAI deployment. It does not trust tenant IDs from browser requests: the host must resolve a session cookie through a `TenantAuthStore`, then derive `TenantRoots` from that authenticated session.

The production store is intended to use Railway Postgres through `DATABASE_URL`. Password verification belongs in the host authentication service and must use a password hash (Argon2id or an equivalent memory-hard password hash), never reversible encryption. Session tokens must be random, stored hashed, scoped to one user and tenant, and revoked on logout.

The root layout is:

```text
<DSH data root>/tenants/<tenant-id>/{sessions,workspace,credentials,failures}
```

This package contains contracts only. It is deliberately not mounted into the Web bundle until the host authentication and Remote principal integration are implemented together.
