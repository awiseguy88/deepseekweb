#!/bin/sh
# Execute one command inside a tenant's filesystem root with bubblewrap.
#
#   bwrap-exec.sh /data/wiseai/workspaces/tenants/<tenantId> <command...>
#
# The tenant sees /workspace bound to its own root; the rest of the host
# filesystem is read-only (system libraries, /usr, /etc) and no other tenant
# directory is mounted. Network stays available by default because package
# installs and git are common agent tasks; set WISEAI_TENANT_NETWORK=off to
# remove it (the model API calls happen in the parent process, not here).
set -eu

root=$1
shift
if [ ! -d "$root" ]; then
  echo "tenant root does not exist: $root" >&2
  exit 1
fi

unshare_net=''
if [ "${WISEAI_TENANT_NETWORK:-on}" = 'off' ]; then
  unshare_net='--unshare-net'
fi

# shellcheck disable=SC2086
exec bwrap \
  --die-with-parent --new-session \
  --unshare-pid --unshare-ipc --unshare-uts --unshare-cgroup-try $unshare_net \
  --ro-bind /usr /usr \
  --ro-bind /bin /bin \
  --ro-bind /sbin /sbin \
  --ro-bind /lib /lib \
  --ro-bind /lib64 /lib64 \
  --ro-bind /etc /etc \
  --proc /proc \
  --dev /dev \
  --tmpfs /tmp \
  --bind "$root" /workspace \
  --chdir /workspace \
  "$@"
