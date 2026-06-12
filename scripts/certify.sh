#!/usr/bin/env bash
set -uo pipefail

# =============================================================================
# Anvay Prod-Readiness Certification
# One run certifies the service end-to-end: infra, demo stack, gateway, web,
# auth, connectors, graph, alert flow, automations, audit, UI.
# Usage: ./scripts/certify.sh
# Exit 0 = CERTIFIED. Exit non-zero = NOT CERTIFIED.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$PROJECT_ROOT/apps/web"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:4000}"
WEB_URL="${WEB_URL:-http://localhost:3000}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}[certify]${NC} $*"; }
warn() { echo -e "${YELLOW}[certify]${NC} $*"; }
err()  { echo -e "${RED}[certify]${NC} $*"; }

STARTED_WEB=""
cleanup() {
  if [ -n "$STARTED_WEB" ]; then
    kill "$STARTED_WEB" 2>/dev/null || true
    wait "$STARTED_WEB" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for() {
  local url=$1 timeout=${2:-60}
  local deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    curl -sf -o /dev/null "$url" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

fail_banner() {
  echo ""
  echo -e "${RED}${BOLD}════════════════════════════════════════════${NC}"
  echo -e "${RED}${BOLD}   NOT CERTIFIED — $1${NC}"
  echo -e "${RED}${BOLD}════════════════════════════════════════════${NC}"
  exit 1
}

cd "$PROJECT_ROOT"

# ── 1. Infra (postgres, redis, neo4j) ──
log "Ensuring core infra is up (postgres/redis/neo4j)..."
docker compose -f infra/docker-compose.yml up -d postgres redis neo4j 2>/dev/null \
  || docker compose -f infra/docker-compose.yml up -d 2>/dev/null \
  || warn "infra compose start failed — assuming services already running"

# ── 2. Demo stack (prometheus, alertmanager, loki, demo services, chaos) ──
log "Ensuring demo stack is up..."
docker compose -f infra/demo/docker-compose.yml up -d 2>/dev/null \
  || warn "demo compose start failed — assuming demo stack already running"

# ── 3. Gateway ──
log "Checking gateway at $GATEWAY_URL/health ..."
if ! wait_for "$GATEWAY_URL/health" 5; then
  log "Gateway not running — starting..."
  cp -n apps/gateway/.env.example apps/gateway/.env 2>/dev/null || true
  set -a; source apps/gateway/.env 2>/dev/null || true; set +a
  (cd apps/gateway && pnpm prisma migrate deploy) >/dev/null 2>&1 || true
  (cd apps/gateway && pnpm dev) > /tmp/anvay-gateway.log 2>&1 &
  if ! wait_for "$GATEWAY_URL/health" 45; then
    err "Gateway did not become healthy. Logs: tail -f /tmp/anvay-gateway.log"
    fail_banner "gateway unhealthy"
  fi
fi
if ! wait_for "$GATEWAY_URL/health/ready" 30; then
  err "Gateway /health/ready not OK — dependencies (DB/Redis) not ready."
  fail_banner "gateway dependencies not ready"
fi
log "Gateway healthy + ready."

# ── 4. Web ──
log "Checking web at $WEB_URL ..."
if ! wait_for "$WEB_URL" 5; then
  log "Web not running — starting dev server..."
  if [ ! -d "$WEB_DIR/node_modules" ]; then
    (cd "$WEB_DIR" && npm install --silent)
  fi
  (cd "$WEB_DIR" && WATCHPACK_POLLING=true npm run dev -- --port 3000) > /tmp/anvay-web.log 2>&1 &
  STARTED_WEB=$!
  if ! wait_for "$WEB_URL/login" 60; then
    err "Web did not start. Logs: tail -f /tmp/anvay-web.log"
    fail_banner "web server unavailable"
  fi
fi
log "Web reachable."

# ── 5. Playwright browser ──
if ! npx playwright install --dry-run chromium 2>/dev/null | grep -q chromium; then
  log "Installing Playwright Chromium..."
  (cd "$WEB_DIR" && npx playwright install chromium)
fi

# ── 6. Run certification suite ──
log "Running certification suite (e2e/99-certification.spec.ts)..."
echo ""
(cd "$WEB_DIR" && npx playwright test e2e/99-certification.spec.ts --reporter=list)
EXIT_CODE=$?

echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}   ✓ CERTIFIED — service is prod ready${NC}"
  echo -e "${GREEN}${BOLD}════════════════════════════════════════════${NC}"
  exit 0
else
  fail_banner "certification suite failed (see failures above)"
fi
