#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Stop old containerized gateway on :4000 (conflicts with source-run) ──
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'infra-gateway'; then
  warn "Stopping old containerized gateway (conflicts with port 4000)..."
  docker stop infra-gateway-1 2>/dev/null || true
fi

# ── Start infra (postgres, redis, neo4j) ──
log "Starting infra services..."
docker compose -f infra/docker-compose.yml up -d postgres redis neo4j 2>/dev/null || \
  docker compose -f infra/docker-compose.yml up -d 2>/dev/null || \
  err "docker compose failed — is Docker running?"

# Wait for postgres
log "Waiting for postgres to be ready..."
TRIES=0
until docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U anvay > /dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  [ $TRIES -ge 30 ] && err "Postgres not ready after 30s"
  sleep 1
done

# ── Env file ──
if [ ! -f apps/gateway/.env ]; then
  cp apps/gateway/.env.example apps/gateway/.env
  log "Created apps/gateway/.env from example"
fi

# ── Install deps ──
log "Installing dependencies..."
pnpm install --silent 2>/dev/null || pnpm install

# ── Migrations ──
log "Running database migrations..."
(cd apps/gateway && pnpm prisma migrate deploy 2>/dev/null) || warn "Migration skipped (DB may already be up to date)"

# ── Kill any existing dev servers on :3000 / :4000 ──
lsof -ti :4000 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti :3000 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# ── Start gateway ──
log "Starting gateway on :4000..."
(cd apps/gateway && pnpm dev) > /tmp/anvay-gateway.log 2>&1 &
GATEWAY_PID=$!

# Wait for gateway health
TRIES=0
until curl -sf http://localhost:4000/health > /dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  [ $TRIES -ge 30 ] && err "Gateway failed to start — check /tmp/anvay-gateway.log"
  sleep 1
done
log "Gateway ready"

# ── Start web ──
log "Starting web on :3000..."
(cd apps/web && pnpm dev) > /tmp/anvay-web.log 2>&1 &
WEB_PID=$!

# Wait for web
TRIES=0
until curl -sf http://localhost:3000 > /dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  [ $TRIES -ge 60 ] && err "Web failed to start — check /tmp/anvay-web.log"
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
echo "  Stop:  kill $GATEWAY_PID $WEB_PID"
echo ""

# Open browser on macOS
open http://localhost:3000 2>/dev/null || true

# Keep script alive so Ctrl+C stops both servers
trap "kill $GATEWAY_PID $WEB_PID 2>/dev/null; echo ''; log 'Stopped.'" EXIT INT TERM
wait $GATEWAY_PID $WEB_PID
