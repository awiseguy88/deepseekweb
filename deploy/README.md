# WiseAI on a Linode VPS

Runbook for moving the hosted WiseAI deployment off Railway onto one Ubuntu
Linode with a single attached volume. Caddy terminates TLS with automatic
Let's Encrypt certificates; the app and Postgres run in Docker Compose.

## 1. DNS and TLS

At your DNS provider create:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | `170.187.145.93` | 300 |
| A | `www` | `170.187.145.93` | 300 |

Wait until `nslookup YOURDOMAIN` and `nslookup www.YOURDOMAIN` both answer with
the Linode IP. Caddy can only obtain a certificate after DNS points at the
server and ports 80/443 are reachable. Nothing else is needed for TLS: Caddy
requests, installs, and renews the certificate itself.

## 2. First boot

From your laptop:

```sh
ssh root@170.187.145.93 'sh -s' < deploy/bootstrap.sh
```

Then create the deployment user, clone, and configure:

```sh
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy/
su - deploy

sudo mkdir -p /opt/wiseai && sudo chown deploy:deploy /opt/wiseai
git clone https://github.com/awiseguy88/deepseekweb.git /opt/wiseai
cd /opt/wiseai/deploy
cp .env.example .env
# fill .env: WISEAI_DOMAIN, DSH_WEB_PUBLIC_URL, DSH_WEB_TRUSTED_HOST,
# WISEAI_SESSION_SECRET (openssl rand -hex 32), POSTGRES_PASSWORD, admin email
docker compose up -d --build
```

Open `https://YOURDOMAIN` — Caddy serves the certificate automatically. Keep
the server firewall (Linode Cloud Firewall) open on 22/80/443 as well.

## 3. Migrating data from Railway

Postgres (only if you want the existing accounts, sessions, and audit history):

```sh
# locally, with the Railway DATABASE_URL
pg_dump --no-owner --format=custom "$RAILWAY_DATABASE_URL" > wiseai.dump
scp wiseai.dump deploy@170.187.145.93:/tmp/
ssh deploy@170.187.145.93 'docker compose -f /opt/wiseai/deploy/docker-compose.yml exec -T postgres pg_restore --no-owner -U wiseai -d wiseai' < /tmp/wiseai.dump
```

Everything below `/data/wiseai` (sessions, workspace files, tenant roots) is the
second half. If the current Railway data is only test content, skip it and start
fresh — it is simpler and avoids carrying stale tenant sessions. If it matters,
archive `/data` from the Railway service and extract it to `/data/wiseai` on the
VPS before starting the app.

Then update the Stripe webhook destination to `https://YOURDOMAIN/stripe/webhook`
(if Stripe is configured) and re-save the endpoint secret in `.env`.

## 4. Cutover order

1. Bring the VPS stack up and verify `https://YOURDOMAIN/login` (DNS can point
   at the VPS while Railway still runs; only one service should own the domain).
2. Point DNS at the Linode, wait for TTL, verify login, admin, `/healthz`.
3. Update Stripe webhook URL.
4. Keep Railway running for a few days as rollback; then stop the service.
5. Rotate `WISEAI_SESSION_SECRET` only when you accept signing everyone out.

## 5. Tenant isolation on one volume

Already shipped in the app: each tenant maps to
`/data/wiseai/workspaces/tenants/<tenantId>`, created mode `700`, with path
containment enforced for the directory picker, workspace creation, and session
creation (traversal and symlink escapes rejected).

For OS-level confinement of shell/tool execution, wrap tenant child processes
with `deploy/bwrap-exec.sh <tenant-root> <command...>`; it bind-mounts only the
tenant root as `/workspace` and leaves the rest of the host read-only. The image
already installs bubblewrap. The remaining wiring is to route shell/terminal/PTC
execution through that wrapper (per-tenant worker or path-derived tenant root).

Per-customer containers are the stronger model and are scaffolded in
`deploy/provision-tenant.sh` (not yet implemented): one app container, one
private root below `/data/customers/<slug>`, one port, one Caddy subdomain.

## 6. Operations

- **Backups:** run restic to Cloudflare R2/Backblaze B2 on a cron:
  `restic -r s3:... backup /data/wiseai /data/postgres`. Keep Postgres dumps
  separately (`docker compose exec postgres pg_dump -U wiseai wiseai`).
- **Disk:** alert at 80% (`df -h /data`); a runaway agent can fill the volume.
  Consider per-tenant quotas later.
- **Updates:** `git -C /opt/wiseai pull && cd deploy && docker compose up -d --build`.
- **Logs:** `docker compose logs -f app`; readiness is `GET /healthz`.
- **Secrets:** `.env` is not committed; keep a copy in a password manager.
