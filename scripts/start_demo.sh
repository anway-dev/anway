#!/usr/bin/env bash
set -euo pipefail

# Raise file descriptor limit — Next.js webpack watches many files, hits macOS default 256
ulimit -n 65536 2>/dev/null || true

# Use polling for file watcher — macOS FSEvents/kqueue has per-process stream limit
# Without this, file watching hits EMFILE and Next.js can't discover app routes
export WATCHPACK_POLLING=true

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

command -v jq > /dev/null 2>&1 || err "jq not installed — brew install jq"

# ── Check Docker is running ──
docker info > /dev/null 2>&1 || err "Docker is not running — start Docker Desktop first"

# ── Stop old containerized gateway/web on same ports ──
for name in infra-gateway-1 infra-web-1; do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${name}$"; then
    warn "Stopping container ${name} (freeing port)..."
    docker stop "$name" 2>/dev/null || true
  fi
done

# ── Start infra (postgres, redis, neo4j) ──
# Use project name 'infra' to match any existing containers
log "Starting infra services (postgres, redis, neo4j)..."
docker compose -p infra -f infra/docker-compose.yml up -d postgres redis neo4j 2>&1 | grep -v '^#' || \
  err "docker compose failed — check infra/docker-compose.yml"

# Wait for postgres
log "Waiting for postgres..."
TRIES=0
until docker exec infra-postgres-1 pg_isready -U anvay > /dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  [ $TRIES -ge 40 ] && err "Postgres not ready after 40s — check: docker logs infra-postgres-1"
  sleep 1
done

# ── Start demo services (Prometheus, Loki, Grafana, Alertmanager, demo apps) ──
log "Starting demo services (prometheus, alertmanager, loki, grafana, demo-apps)..."
docker compose -p demo -f infra/demo/docker-compose.yml up -d 2>&1 | grep -v '^#' || \
  warn "demo docker-compose failed — check infra/demo/docker-compose.yml"

# Wait for Prometheus
log "Waiting for Prometheus..."
TRIES=0
until curl -sf http://localhost:9090/-/ready > /dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  [ $TRIES -ge 30 ] && { warn "Prometheus not ready after 30s"; break; }
  sleep 1
done

# ── Env file — always refresh from example for demo ──
cp -n apps/gateway/.env.example apps/gateway/.env
log "apps/gateway/.env initialized from example (existing file preserved)"

# Export vars into current shell so child processes inherit them
# (tsx does not auto-load .env — reads process.env directly)
set -a
# shellcheck disable=SC1091
source apps/gateway/.env
set +a

# ── Install deps ──
log "Installing dependencies..."
pnpm install --silent 2>/dev/null || pnpm install

# ── Migrations ──
log "Running database migrations..."
(cd apps/gateway && pnpm prisma migrate deploy) 2>/dev/null || \
  warn "Migration skipped (may already be up to date)"

# ── Free ports 3000 / 4000 ──
lsof -ti :4000 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti :3000 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# ── Start gateway ──
log "Starting gateway on :4000..."
(cd apps/gateway && pnpm dev) > /tmp/anvay-gateway.log 2>&1 &
GATEWAY_PID=$!

TRIES=0
until curl -sf http://localhost:4000/health > /dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  if [ $TRIES -ge 40 ]; then
    echo ""
    warn "Gateway log tail:"
    tail -20 /tmp/anvay-gateway.log
    err "Gateway failed to start — full log: /tmp/anvay-gateway.log"
  fi
  sleep 1
done
log "Gateway ready"

# ── Seed demo connectors ──
log "Fetching dev token..."
DEV_TOKEN=$(curl -sf http://localhost:4000/api/auth/dev-token | jq -r '.token // empty' 2>/dev/null) || DEV_TOKEN=""
if [ -z "$DEV_TOKEN" ]; then
  # Fallback: POST to /auth/token
  DEV_TOKEN=$(curl -sf -X POST http://localhost:4000/auth/token \
    -H "Content-Type: application/json" \
    -d '{"email":"dev@anvay.local","tenantId":"00000000-0000-0000-0000-000000000001"}' | jq -r '.token // empty' 2>/dev/null) || DEV_TOKEN=""
fi

if [ -n "$DEV_TOKEN" ]; then
  AUTH="Authorization: Bearer $DEV_TOKEN"
  for connector in prometheus loki grafana github alertmanager; do
    log "Seeding connector: $connector"
    CREDENTIALS="{}"
    case "$connector" in
      prometheus)    CREDENTIALS='{"baseUrl":"http://localhost:9090"}' ;;
      loki)          CREDENTIALS='{"baseUrl":"http://localhost:3100"}' ;;
      grafana)       CREDENTIALS='{"baseUrl":"http://localhost:3001","password":"admin"}' ;;
      github)        CREDENTIALS='{"token":"demo-gitea-token","baseUrl":"http://localhost:3030","org":"anvay-demo"}' ;;
      alertmanager)  CREDENTIALS='{"baseUrl":"http://localhost:9093"}' ;;
    esac
    curl -sf -X PUT "http://localhost:4000/api/settings/connectors/$connector" \
      -H "Content-Type: application/json" \
      -H "$AUTH" \
      -d "{\"credentials\":$CREDENTIALS}" > /dev/null 2>&1 && log "  $connector configured" || warn "  $connector failed"

    # Trigger bootstrap
    curl -sf -X POST "http://localhost:4000/api/connectors/$connector/bootstrap" \
      -H "$AUTH" > /dev/null 2>&1 && log "  $connector bootstrapped" || warn "  $connector bootstrap skipped"
  done
else
  warn "No dev token — skipping connector seeding"
fi

# ── Start web ──
log "Starting web on :3000..."
# Unset PORT so Next.js uses its default (:3000), not the gateway's PORT=4000
(cd apps/web && env -u PORT pnpm dev) > /tmp/anvay-web.log 2>&1 &
WEB_PID=$!

TRIES=0
until curl -s http://localhost:3000 -o /dev/null -w "%{http_code}" 2>/dev/null | grep -qE '^[23]'; do
  TRIES=$((TRIES + 1))
  if [ $TRIES -ge 60 ]; then
    echo ""
    warn "Web log tail:"
    tail -20 /tmp/anvay-web.log
    err "Web failed to start — full log: /tmp/anvay-web.log"
  fi
  sleep 1
done
log "Web ready"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Anvay demo is running${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Open:    http://localhost:3000"
echo "  Gateway: http://localhost:4000/health"
echo ""
echo "  Logs:  tail -f /tmp/anvay-gateway.log"
echo "         tail -f /tmp/anvay-web.log"
echo ""
echo "  Stop: Ctrl+C"
echo ""

open http://localhost:3000 2>/dev/null || true

trap "kill $GATEWAY_PID $WEB_PID 2>/dev/null; docker compose -p demo -f infra/demo/docker-compose.yml down 2>/dev/null; echo ''; log 'Stopped.'" EXIT INT TERM
wait $GATEWAY_PID $WEB_PID
