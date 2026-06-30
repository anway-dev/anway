#!/usr/bin/env bash
# Backs up Anway Postgres + Redis to a timestamped directory.
# Usage: ./scripts/backup.sh [OUTPUT_DIR]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/backups}/$(date '+%Y%m%d_%H%M%S')"
mkdir -p "$OUT"

echo "[backup] Postgres → $OUT/postgres.dump"
pg_dump "${DATABASE_URL:-postgres://anway:anway@localhost:5432/anway}" \
  --format=custom --no-owner --no-acl \
  -f "$OUT/postgres.dump"

echo "[backup] Redis → $OUT/redis.rdb"
redis-cli -u "${REDIS_URL:-redis://localhost:6379}" \
  --no-auth-warning BGSAVE
# Wait for save to complete
for i in $(seq 1 30); do
  LASTSAVE=$(redis-cli -u "${REDIS_URL:-redis://localhost:6379}" LASTSAVE)
  sleep 1
  NEWSAVE=$(redis-cli -u "${REDIS_URL:-redis://localhost:6379}" LASTSAVE)
  [ "$NEWSAVE" != "$LASTSAVE" ] && break
done
redis-cli -u "${REDIS_URL:-redis://localhost:6379}" --no-auth-warning \
  DEBUG JMAP 2>/dev/null || true
# Copy RDB — location varies; try common paths
for RDB_PATH in /var/lib/redis/dump.rdb /data/dump.rdb ./dump.rdb; do
  [ -f "$RDB_PATH" ] && cp "$RDB_PATH" "$OUT/redis.rdb" && break
done

echo "[backup] done → $OUT"
echo "$OUT"
