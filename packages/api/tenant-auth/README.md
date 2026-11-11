# WiseAI tenant authentication

With `WISEAI_AUTH_REQUIRED=1`, the Web profile loads this plugin after Connection and WebServer become available. Open `/login` to sign in. If the enabled plugin fails to activate, Web startup reports the failure. The PostgreSQL connection URL comes from the host environment.

This package provides the server-side identity seam for a hosted WiseAI deployment. Passwords are hashed with Node's built-in Argon2id implementation; browser sessions are opaque random tokens whose SHA-256 digests are stored in PostgreSQL. The `tenantAuthHandler` function is intentionally transport-neutral and can be mounted at `/auth/*` by the host WebServer.

Every authenticated record carries a tenant id. Resolve tenant-owned directories with `tenantRoots(dataRoot, tenantId)` and never accept a tenant id from a browser request. `recordTenantFailure` appends bounded JSONL diagnostics under that tenant's `failures` directory. `retryTransient` is a finite, cancellation-aware retry helper for transient provider calls; it must not wrap non-idempotent mutations.

Run `migrations/001_tenant_auth.sql` and `migrations/002_wiseai_admin.sql` against the Railway PostgreSQL `DATABASE_URL` before enabling login, or let the plugin apply the idempotent migration set on startup. Set `WISEAI_AUTH_REQUIRED=1`, `DATABASE_URL`, and a randomly generated `WISEAI_SESSION_SECRET` (at least 32 characters) in Railway variables; the start script refuses to expose the owner-only composition when those required values are missing. On the first deployment, set `WISEAI_ADMIN_EMAIL` and `WISEAI_ADMIN_PASSWORD` (at least 12 characters) once; the plugin creates the initial admin tenant and marks that account as a platform operator if that email is absent. Remove the password variable after bootstrap. Keep secrets and provider keys in Railway variables, never in Git.

## Hosted administration

The hosted application is closed: signed-out document requests are redirected to `/login`, and only the public marketing page remains open at `/welcome` (`WISEAI_LANDING_PAGE`, served by this plugin). Login is required before the app shell renders.

Platform operators reach the admin surface at `/admin`; tenant administrators use the same page, scoped to their own tenant. The page and its JSON API under `/admin/api/*` manage customer tenants, accounts, sessions, the support inbox, and the Stripe sales ledger. A tenant-scoped `/admin/users` endpoint remains for tenant administrators.

## Tenant isolation

Every Session a signed-in tenant creates is claimed for that tenant (along with Workspaces), and a single `remoteAccess` policy for the `tenant` principal kind exposes only those resources: list calls filter through the policy bindings, and Session/Workspace calls and forwarded events are refused unless the resource belongs to the caller's tenant. Ownership is persisted in the `wiseai_session_owners` and `wiseai_workspace_owners` tables and hydrated on boot, so isolation survives restarts. The process-token owner peer (the URL printed by `dsh web`) remains unrestricted for operations.

Signed-in customers file support requests from the in-app **Need help?** control; the plugin accepts them at `POST /support/requests` and joins them with the tenant and account for the admin inbox. The request carries only subject, message, and page URL — the tenant and account come from the session.

Stripe billing is optional. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID` to enable it, then point a Stripe webhook at `/stripe/webhook`. The endpoint verifies the `Stripe-Signature` header, records each event in `wiseai_sales_events`, and applies the subscription status and access window to the customer tenant. `createCheckoutLink` builds subscription Checkout Sessions with the tenant id in metadata so the webhook can join the payment back to the customer.
