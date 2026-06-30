#!/usr/bin/env bash
# Restores Anway from a backup directory created by backup.sh.
# Usage: ./scripts/restore.sh BACKUP_DIR
set -euo pipefail
BACKUP="${1:?Usage: restore.sh BACKUP_DIR}"

echo "[restore] Postgres ← $BACKUP/postgres.dump"
pg_restore "${DATABASE_URL:-postgres://anway:anway@localhost:5432/anway}" \
  --clean --if-exists --no-owner --no-acl \
  "$BACKUP/postgres.dump"

if [ -f "$BACKUP/redis.rdb" ]; then
  echo "[restore] Redis ← $BACKUP/redis.rdb — manual step required"
  echo "  Stop Redis, copy $BACKUP/redis.rdb to Redis data dir, restart Redis"
fi

echo "[restore] done"
