#!/bin/sh
# Pre-create one tenant's filesystem root on the shared volume.
# The application also creates this lazily; the script exists so an operator can
# prepare storage (and future per-tenant containers) before a customer signs in.
#
#   provision-tenant.sh <tenant-id> [container|directory]
set -eu

tenant_id=${1:?usage: provision-tenant.sh <tenant-id> [container|directory]}
mode=${2:-directory}
base=${WISEAI_TENANT_ROOT:-/data/wiseai/workspaces/tenants}
root="$base/$tenant_id"

case "$tenant_id" in
  *[!A-Za-z0-9_-]*|'') echo 'tenant id must be [A-Za-z0-9_-]+' >&2; exit 2 ;;
esac

case "$mode" in
  directory)
    mkdir -p "$root"
    chmod 700 "$root"
    echo "tenant root ready: $root"
    ;;
  container)
    # Per-customer container plan: each customer gets its own app container, a
    # private root below /data/customers, its own port, and a Caddy subdomain.
    # Wire this once the container-per-customer image entrypoint exists.
    echo 'container-per-customer provisioning is not implemented yet; use directory mode' >&2
    exit 3
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
