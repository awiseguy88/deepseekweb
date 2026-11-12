#!/bin/sh
# Nightly local backup of the WiseAI database and data volume.
# Run by root cron; keep seven days on the volume. Off-site copies should be
# added with restic/rclone once remote storage credentials are available.
set -eu

BACKUP_DIR=${WISEAI_BACKUP_DIR:-/data/backups}
COMPOSE_DIR=${WISEAI_COMPOSE_DIR:-/opt/wiseai/deploy}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"

cd "$COMPOSE_DIR"
docker compose exec -T postgres pg_dump -U wiseai -d wiseai --format=custom > "$BACKUP_DIR/db-$STAMP.dump"

tar -czf "$BACKUP_DIR/data-$STAMP.tgz" -C /data --exclude='backups' wiseai

find "$BACKUP_DIR" -type f -mtime +7 -delete
echo "wiseai backup $STAMP complete: $(du -sh "$BACKUP_DIR" | cut -f1)"
