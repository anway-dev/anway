#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Anvay E2E Suite Runner
# Starts required services, runs Playwright E2E tests, reports results.
# Usage: ./scripts/run-e2e.sh [playwright-flags...]
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$PROJECT_ROOT/apps/web"
GATEWAY_URL:-http://127.0.0.1:8510}}"
WEB_URL="${WEB_URL:-http://localhost:8500}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cleanup() {
  if [ -n "${WEB_PID:-}" ]; then
    echo -e "${YELLOW}Stopping web dev server (pid $WEB_PID)...${NC}"
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---- helpers ----
log()  { echo -e "${GREEN}[e2e]${NC} $*"; }
warn() { echo -e "${YELLOW}[e2e]${NC} $*"; }
err()  { echo -e "${RED}[e2e]${NC} $*"; }

wait_for() {
  local url=$1 timeout=${2:-30} label=${3:-"$url"}
  local deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# ---- check prerequisites ----
if ! command -v npx &>/dev/null; then
  err "npx not found. Install Node.js / npm."
  exit 1
fi

if [ ! -d "$WEB_DIR" ]; then
  err "Web app not found at $WEB_DIR"
  exit 1
fi

# ---- check gateway ----
log "Checking gateway at $GATEWAY_URL/health ..."
if ! wait_for "$GATEWAY_URL/health" 5 "gateway"; then
  warn "Gateway not reachable at $GATEWAY_URL"
  warn "Start it: docker compose -f infra/docker-compose.yml up -d"
  warn "Tests that hit the gateway will fail."
else
  log "Gateway reachable ($(curl -sf "$GATEWAY_URL/health" | head -c 80))"
fi

# ---- install deps if needed ----
if [ ! -d "$WEB_DIR/node_modules" ]; then
  log "Installing web dependencies..."
  (cd "$WEB_DIR" && npm install --silent)
fi

# ---- check playwright browsers ----
if ! npx playwright install --dry-run chromium 2>/dev/null | grep -q chromium; then
  log "Installing Playwright Chromium browser..."
  npx playwright install chromium
fi

# ---- start web dev server ----
log "Starting web dev server..."
cd "$WEB_DIR"
npm run dev -- --port 3000 &
WEB_PID=$!

log "Waiting for web server at $WEB_URL ..."
if ! wait_for "$WEB_URL" 30 "web"; then
  err "Web server did not start at $WEB_URL within 30s"
  exit 1
fi
log "Web server ready."

# ---- run tests ----
log "Running E2E tests..."
echo ""

cd "$WEB_DIR"
npx playwright test "$@" 2>&1
EXIT_CODE=$?

echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  log "All E2E tests passed."
else
  err "E2E tests exited with code $EXIT_CODE"
fi

exit "$EXIT_CODE"
