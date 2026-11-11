#!/bin/sh
set -eu

: "${PORT:=8080}"

if [ -n "${DSH_WEB_PUBLIC_URL:-}" ]; then
  public_url="$DSH_WEB_PUBLIC_URL"
  trusted_host="${DSH_WEB_TRUSTED_HOST:-}"
  if [ -z "$trusted_host" ]; then
    echo 'DSH_WEB_TRUSTED_HOST is required when DSH_WEB_PUBLIC_URL is set.' >&2
    exit 64
  fi
else
  if [ -z "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
    echo 'Generate a Railway public domain or set DSH_WEB_PUBLIC_URL and DSH_WEB_TRUSTED_HOST.' >&2
    exit 64
  fi
  public_url="https://${RAILWAY_PUBLIC_DOMAIN}/"
  trusted_host="$RAILWAY_PUBLIC_DOMAIN"
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

exec pnpm start:web -- --no-open --host "$bind_host" --port "$PORT" --public-url "$public_url" --trusted-host "$trusted_host"
