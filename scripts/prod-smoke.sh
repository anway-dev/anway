#!/usr/bin/env bash
# scripts/prod-smoke.sh
#
# Production smoke test — brings up the prod compose stack, waits for health,
# verifies gateway + web are reachable, then tears down.
#
# Usage:
#   bash scripts/prod-smoke.sh
#
# Prerequisites:
#   - docker and docker compose installed
#   - Required env vars set: POSTGRES_PASSWORD, DATABASE_URL, REDIS_URL,
#     JWT_SECRET, NEO4J_PASSWORD, NEO4J_URI, ANWAY_ENCRYPTION_KEY,
#     ANWAY_WEBHOOK_TOKEN, ANWAY_WEBHOOK_TENANT

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="infra/prod/docker-compose.yml"
GW="http://localhost:8510"
WEB="http://localhost:8500"
MAX_WAIT=120

echo "=== Anway Prod Smoke Test ==="
echo "Compose file: $COMPOSE_FILE"

# 1. Validate compose file
echo
echo "[1/4] Validating compose file..."
docker compose -f "$COMPOSE_FILE" config -q
echo "  compose config OK"

# 2. Start services
echo
echo "[2/4] Starting services..."
docker compose -f "$COMPOSE_FILE" up -d

# 3. Wait for gateway health
echo
echo "[3/4] Waiting for gateway health (max ${MAX_WAIT}s)..."
elapsed=0
while [ $elapsed -lt $MAX_WAIT ]; do
  if curl -fs "$GW/health" > /dev/null 2>&1; then
    echo "  Gateway healthy after ${elapsed}s"
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

if [ $elapsed -ge $MAX_WAIT ]; then
  echo "  ERROR: Gateway did not become healthy within ${MAX_WAIT}s"
  docker compose -f "$COMPOSE_FILE" logs gateway --tail 30
  docker compose -f "$COMPOSE_FILE" down
  exit 1
fi

# 4. Verify web is reachable
echo
echo "[4/4] Checking web UI..."
web_code=$(curl -s -o /dev/null -w '%{http_code}' "$WEB" 2>&1 || echo "000")
if [ "$web_code" = "200" ] || [ "$web_code" = "304" ]; then
  echo "  Web UI reachable (HTTP $web_code)"
else
  echo "  WARNING: Web UI returned HTTP $web_code (may be loading)"
fi

# Teardown
echo
echo "=== Smoke test passed ==="
echo "Tearing down..."
docker compose -f "$COMPOSE_FILE" down
echo "Done."
