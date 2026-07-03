#!/usr/bin/env bash
# End-to-end smoke test — verifies all Anway services are healthy.
# Run after: docker compose -f infra/docker-compose.dev.yml up -d
#
# Exits 0 if all checks pass, 1 if any fail.

set -uo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8510}"
WEB_URL="${WEB_URL:-http://localhost:8500}"
PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
TIMEOUT="${SMOKE_TIMEOUT:-300}"

PASS=0
FAIL=0

log()  { printf '[smoke] %s\n' "$*"; }
ok()   { log "PASS: $*"; PASS=$((PASS + 1)); }
fail() { log "FAIL: $*"; FAIL=$((FAIL + 1)); }

# Polls URL until it responds or timeout is reached. Returns 0 on success, 1 on timeout.
wait_for() {
  local url="$1"
  local label="$2"
  local deadline=$((SECONDS + TIMEOUT))
  log "Waiting for ${label} (${url})..."
  while [[ $SECONDS -lt $deadline ]]; do
    if curl -sf --max-time 5 "$url" > /dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}

# ── 1. Gateway /health ────────────────────────────────────────────────────────
if wait_for "${GATEWAY_URL}/health" "gateway"; then
  response=$(curl -sf "${GATEWAY_URL}/health" 2>/dev/null || true)
  if printf '%s' "${response}" | grep -q '"status"'; then
    ok "gateway /health → ${response}"
  else
    fail "gateway /health: unexpected response: ${response}"
  fi
else
  fail "gateway /health: timed out after ${TIMEOUT}s"
fi

# ── 2. Web /api/providers ─────────────────────────────────────────────────────
if wait_for "${WEB_URL}/api/providers" "web"; then
  response=$(curl -sf "${WEB_URL}/api/providers" 2>/dev/null || true)
  if printf '%s' "${response}" | grep -q '"providers"'; then
    ok "web /api/providers → ok"
  else
    fail "web /api/providers: unexpected response: ${response}"
  fi
else
  fail "web /api/providers: timed out after ${TIMEOUT}s"
fi

# ── 3. Prometheus targets ─────────────────────────────────────────────────────
if wait_for "${PROMETHEUS_URL}/-/healthy" "prometheus"; then
  targets=$(curl -sf "${PROMETHEUS_URL}/api/v1/targets" 2>/dev/null || echo '{}')
  down=$(printf '%s' "${targets}" | grep -o '"health":"down"' | wc -l | tr -d ' ')
  up=$(printf '%s' "${targets}" | grep -o '"health":"up"' | wc -l | tr -d ' ')
  if [[ "${down}" -gt 0 ]]; then
    fail "Prometheus: ${down} target(s) DOWN, ${up} UP"
  else
    ok "Prometheus: all ${up} target(s) UP"
  fi
else
  fail "Prometheus: timed out after ${TIMEOUT}s"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
printf '\n[smoke] Results: %d passed, %d failed\n' "${PASS}" "${FAIL}"

if [[ "${FAIL}" -gt 0 ]]; then
  exit 1
fi
exit 0
