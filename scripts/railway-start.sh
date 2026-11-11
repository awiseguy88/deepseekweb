#!/bin/sh
set -eu

: "${PORT:=8080}"

# Hosted WiseAI deployments opt into the tenant plane explicitly. Keeping the
# switch opt-in preserves local `dsh web` development while making a Railway
# misconfiguration fail before the app exposes an owner-only surface.
if [ "${WISEAI_AUTH_REQUIRED:-0}" = "1" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo 'WISEAI_AUTH_REQUIRED=1 requires DATABASE_URL.' >&2
    exit 64
  fi
  if [ -z "${WISEAI_SESSION_SECRET:-}" ] || [ "${#WISEAI_SESSION_SECRET}" -lt 32 ]; then
    echo 'WISEAI_AUTH_REQUIRED=1 requires WISEAI_SESSION_SECRET (at least 32 characters).' >&2
    exit 64
  fi
  # Publish the marketing document as the signed-out home page. The image copies
  # the repository at /app, so the default needs no Railway variable.
  : "${WISEAI_LANDING_PAGE:=/app/wiseai-immersive.html}"
  export WISEAI_LANDING_PAGE
  # Sessions live on the persistent volume; an old session whose container-local
  # project root vanished recovers to this directory instead of failing.
  : "${WISEAI_WORKSPACE_ROOT:=/data/workspace}"
  mkdir -p "$WISEAI_WORKSPACE_ROOT"
  export WISEAI_WORKSPACE_ROOT
  : "${WISEAI_RECOVER_MISSING_CWD:=1}"
  export WISEAI_RECOVER_MISSING_CWD
fi

public_url="${DSH_WEB_PUBLIC_URL:-}"
trusted_host="${DSH_WEB_TRUSTED_HOST:-}"
railway_domain="${RAILWAY_PUBLIC_DOMAIN:-}"
if [ -n "$railway_domain" ]; then
  # Railway's generated domain wins over a stale *.up.railway.app value in
  # DSH_WEB_PUBLIC_URL; an explicit custom domain is kept.
  case "$public_url" in
    ""|*".up.railway.app"*) public_url="https://${railway_domain}/" ;;
  esac
  if [ -z "$trusted_host" ]; then trust_host_extra="$railway_domain"; fi
fi
if [ -z "$public_url" ] || { [ -z "$trusted_host" ] && [ -z "${trust_host_extra:-}" ]; }; then
  echo 'Set DSH_WEB_PUBLIC_URL and DSH_WEB_TRUSTED_HOST, or provide RAILWAY_PUBLIC_DOMAIN.' >&2
  exit 64
fi

trusted_args=""
if [ -n "$trusted_host" ]; then trusted_args="--trusted-host $trusted_host"; fi
if [ -n "${trust_host_extra:-}" ] && [ "${trust_host_extra:-}" != "$trusted_host" ]; then
  trusted_args="${trusted_args} --trusted-host $trust_host_extra"
fi

set -- $(hostname -I 2>/dev/null || hostname -i)
bind_host=""
for candidate in "$@"; do
  case "$candidate" in
    127.*|::1) continue ;;
    *) bind_host="$candidate"; break ;;
  esac
done
if [ -z "$bind_host" ]; then
  echo 'Cannot determine the container IP address.' >&2
  exit 69
fi

# shellcheck disable=SC2086
exec pnpm start:web -- --no-open --host "$bind_host" --port "$PORT" --public-url "$public_url" $trusted_args
